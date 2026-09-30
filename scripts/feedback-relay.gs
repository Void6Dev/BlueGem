/**
 * Ретранслятор отзывов на Google Apps Script.
 *
 * Зачем: письмо уходит по квоте Gmail — 100 в сутки на обычном аккаунте, —
 * денег не стоит, и стороннего сервиса между приложением и почтой нет.
 * Gmail API для этого не нужен и не годится: он требует OAuth, то есть токен
 * пришлось бы вшить в сборку, откуда его достанет кто угодно.
 *
 * Как поставить (пять минут, всё в браузере):
 *   1. script.google.com → «Новый проект», вставить сюда этот файл целиком.
 *   2. Заменить RECIPIENT на свой адрес, если он не void6dev@gmail.com.
 *   3. «Начать развёртывание» → «Новое развёртывание» → тип «Веб-приложение».
 *      Запуск от имени: «от моего имени». Доступ: «Все» — иначе приложение
 *      не сможет достучаться без входа в аккаунт Google.
 *   4. Google один раз спросит разрешение на отправку почты — выдать.
 *   5. Скопировать выданный URL вида https://script.google.com/macros/s/…/exec
 *      и положить его в electron/feedback.local.json: { "relayUrl": "<URL>" }.
 *      Файл в .gitignore — в открытый репозиторий адрес не попадает, а в
 *      сборку попадает (electron-builder берёт electron/** целиком).
 *
 * Проверить, что живо, можно прямо из консоли:
 *   curl -L -X POST -H "Content-Type: application/json" \
 *     -d '{"subject":"тест","message":"проверка"}' "<URL>"
 *
 * Внимание: адрес открыт всему интернету — это неизбежно, приложение ходит
 * без авторизации. Поэтому ниже стоят проверки: чужие поля игнорируются,
 * длина письма ограничена, а отправитель ставится в reply-to, а не в «от кого»,
 * чтобы подделанным адресом нельзя было испортить репутацию ящика.
 */

var RECIPIENT = "void6dev@gmail.com";
var MAX_LEN = 8000;

function doPost(e) {
  try {
    var raw = (e && e.postData && e.postData.contents) || "{}";
    var data = JSON.parse(raw);

    var subject = String(data.subject || "").slice(0, 200);
    var message = String(data.message || "").slice(0, MAX_LEN);
    if (!subject && !message) return reply({ success: false, message: "empty" });

    // Обратный адрес приходит от пользователя, доверять ему нельзя: ставим его
    // только в reply-to и только если он похож на почту.
    var replyTo = String(data.replyto || "").slice(0, 200);
    var options = { name: "BlueGem" };
    if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(replyTo)) options.replyTo = replyTo;

    MailApp.sendEmail(RECIPIENT, subject || "BlueGem: отзыв", message, options);
    return reply({ success: true });
  } catch (err) {
    return reply({ success: false, message: String(err) });
  }
}

/** GET открывают люди и поисковики — отвечаем, но письма не шлём. */
function doGet() {
  return reply({ success: true, message: "BlueGem feedback relay" });
}

function reply(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}
