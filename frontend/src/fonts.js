// Шрифты лежат внутри приложения, а не тянутся с fonts.googleapis.com:
// десктопная сборка должна работать без интернета вообще.
//
// Пакеты @fontsource-variable — вариативные версии тех же шрифтов: один файл
// на подмножество символов вместо файла на каждое начертание, и кириллица
// внутри. Отсюда и суффикс "Variable" в именах семейств — сопоставление
// «настройка → семейство» живёт в lib/settings.js (fontStack).
import "@fontsource-variable/manrope/wght.css";
import "@fontsource-variable/inter/wght.css";
import "@fontsource-variable/space-grotesk/wght.css";
import "@fontsource-variable/lora/wght.css";
import "@fontsource-variable/jetbrains-mono/wght.css";
// Playfair Display больше не подключаем: заголовочным стал Space Grotesk
// (--sw-font-display). Пакет остался в package.json — выкидывать его нужно
// вместе с обновлением lock-файла, отдельным шагом.
