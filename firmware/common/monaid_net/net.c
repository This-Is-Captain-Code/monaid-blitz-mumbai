#include "monaid_net.h"

#include <string.h>
#include <stdio.h>
#include <time.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "esp_wifi.h"
#include "esp_event.h"
#include "esp_netif.h"
#include "esp_netif_sntp.h"
#include "esp_crt_bundle.h"
#include "esp_log.h"
#include "nvs_flash.h"
#include "mqtt_client.h"

static const char *TAG = "monaid_net";

static monaid_net_cfg_t s_cfg;
static esp_mqtt_client_handle_t s_mqtt;
static volatile bool s_connected = false;
static uint32_t s_seq = 0;
static bool s_mqtt_started = false;
static char s_topic_status[64], s_topic_evt[64], s_topic_cmd[64];

static void mqtt_start_task(void *arg) {
    // TLS needs a sane clock before the first handshake.
    if (strncmp(s_cfg.broker_uri, "mqtts", 5) == 0) {
        if (esp_netif_sntp_sync_wait(pdMS_TO_TICKS(15000)) == ESP_OK) {
            ESP_LOGI(TAG, "time synced");
        } else {
            ESP_LOGW(TAG, "sntp timeout, trying TLS anyway");
        }
    }
    esp_mqtt_client_start(s_mqtt);
    vTaskDelete(NULL);
}

static void wifi_event_handler(void *arg, esp_event_base_t base, int32_t id, void *data) {
    if (base == WIFI_EVENT && id == WIFI_EVENT_STA_START) {
        esp_wifi_connect();
    } else if (base == WIFI_EVENT && id == WIFI_EVENT_STA_DISCONNECTED) {
        ESP_LOGW(TAG, "wifi lost, reconnecting");
        vTaskDelay(pdMS_TO_TICKS(1000));
        esp_wifi_connect();
    } else if (base == IP_EVENT && id == IP_EVENT_STA_GOT_IP) {
        ip_event_got_ip_t *e = (ip_event_got_ip_t *)data;
        ESP_LOGI(TAG, "got ip " IPSTR, IP2STR(&e->ip_info.ip));
        if (!s_mqtt_started) {
            s_mqtt_started = true; // esp-mqtt reconnects on its own after first start
            xTaskCreate(mqtt_start_task, "mqtt_start", 4096, NULL, 5, NULL);
        }
    }
}

static void mqtt_event_handler(void *arg, esp_event_base_t base, int32_t id, void *data) {
    esp_mqtt_event_handle_t e = (esp_mqtt_event_handle_t)data;
    switch ((esp_mqtt_event_id_t)id) {
    case MQTT_EVENT_CONNECTED:
        s_connected = true;
        esp_mqtt_client_publish(s_mqtt, s_topic_status, "online", 0, 1, 1);
        esp_mqtt_client_subscribe(s_mqtt, s_topic_cmd, 1);
        ESP_LOGI(TAG, "mqtt connected");
        if (s_cfg.on_conn) s_cfg.on_conn(true);
        break;
    case MQTT_EVENT_DISCONNECTED:
        s_connected = false;
        ESP_LOGW(TAG, "mqtt disconnected");
        if (s_cfg.on_conn) s_cfg.on_conn(false);
        break;
    case MQTT_EVENT_DATA:
        if (s_cfg.on_cmd && e->topic_len && strncmp(e->topic, s_topic_cmd, e->topic_len) == 0)
            s_cfg.on_cmd(e->data, e->data_len);
        break;
    default:
        break;
    }
}

esp_err_t monaid_net_start(const monaid_net_cfg_t *cfg) {
    s_cfg = *cfg;
    snprintf(s_topic_status, sizeof(s_topic_status), "monaid/%s/status", cfg->dev_id);
    snprintf(s_topic_evt, sizeof(s_topic_evt), "monaid/%s/evt", cfg->dev_id);
    snprintf(s_topic_cmd, sizeof(s_topic_cmd), "monaid/%s/cmd", cfg->dev_id);

    esp_err_t err = nvs_flash_init();
    if (err == ESP_ERR_NVS_NO_FREE_PAGES || err == ESP_ERR_NVS_NEW_VERSION_FOUND) {
        ESP_ERROR_CHECK(nvs_flash_erase());
        ESP_ERROR_CHECK(nvs_flash_init());
    }
    ESP_ERROR_CHECK(esp_netif_init());
    ESP_ERROR_CHECK(esp_event_loop_create_default());
    esp_netif_create_default_wifi_sta();

    wifi_init_config_t wic = WIFI_INIT_CONFIG_DEFAULT();
    ESP_ERROR_CHECK(esp_wifi_init(&wic));
    ESP_ERROR_CHECK(esp_event_handler_register(WIFI_EVENT, ESP_EVENT_ANY_ID, wifi_event_handler, NULL));
    ESP_ERROR_CHECK(esp_event_handler_register(IP_EVENT, IP_EVENT_STA_GOT_IP, wifi_event_handler, NULL));

    wifi_config_t wc = { 0 };
    strlcpy((char *)wc.sta.ssid, cfg->wifi_ssid, sizeof(wc.sta.ssid));
    strlcpy((char *)wc.sta.password, cfg->wifi_pass, sizeof(wc.sta.password));
    wc.sta.threshold.authmode = WIFI_AUTH_WPA2_PSK;
    ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_STA));
    ESP_ERROR_CHECK(esp_wifi_set_config(WIFI_IF_STA, &wc));

    // MQTT client created up front; started on first GOT_IP.
    esp_sntp_config_t sntp = ESP_NETIF_SNTP_DEFAULT_CONFIG("pool.ntp.org");
    ESP_ERROR_CHECK(esp_netif_sntp_init(&sntp));

    esp_mqtt_client_config_t mc = {
        .broker.address.uri = cfg->broker_uri,
        .broker.verification.crt_bundle_attach = esp_crt_bundle_attach, // used only for mqtts://
        .credentials.username = cfg->mqtt_user,
        .credentials.authentication.password = cfg->mqtt_pass,
        .credentials.client_id = cfg->dev_id,
        .session.keepalive = 5, // snappy last-will: death beat in ~8s
        .session.last_will = {
            .topic = s_topic_status,
            .msg = "offline",
            .qos = 1,
            .retain = 1,
        },
        .network.reconnect_timeout_ms = 2000,
    };
    s_mqtt = esp_mqtt_client_init(&mc);
    ESP_ERROR_CHECK(esp_mqtt_client_register_event(s_mqtt, ESP_EVENT_ANY_ID, mqtt_event_handler, NULL));

    ESP_ERROR_CHECK(esp_wifi_start());
    return ESP_OK;
}

esp_err_t monaid_net_event(const char *kind, const char *data_json) {
    if (!s_connected) return ESP_ERR_INVALID_STATE;
    char payload[512];
    int n = snprintf(payload, sizeof(payload),
                     "{\"dev\":\"%s\",\"kind\":\"%s\",\"seq\":%lu,\"ts\":%lld,\"data\":%s,\"sig\":\"\"}",
                     s_cfg.dev_id, kind, (unsigned long)++s_seq, (long long)time(NULL),
                     data_json ? data_json : "{}");
    if (n < 0 || n >= (int)sizeof(payload)) return ESP_ERR_INVALID_SIZE;
    int id = esp_mqtt_client_publish(s_mqtt, s_topic_evt, payload, n, 1, 0);
    return id >= 0 ? ESP_OK : ESP_FAIL;
}

bool monaid_net_connected(void) { return s_connected; }
