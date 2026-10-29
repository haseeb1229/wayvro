// Maestro runScript (GraalJS, host side): the 6-digit code of the first OTP message recorded for PHONE after the
// baseline taken by otp-baseline.js. Throws while the in-process otp.deliver job has not recorded it yet; the calling
// flow wraps this script in a bounded `retry` (no sleep-based wait).
var res = http.get(API + '/__local/otp-inbox?phone=' + encodeURIComponent(PHONE));
if (!res.ok) throw new Error('otp inbox unavailable: HTTP ' + res.status);
var messages = json(res.body).messages;
var baseline = Number(output.otpBaseline || '0');
var best = null;
for (var i = 0; i < messages.length; i++) {
  var t = Date.parse(messages[i].recordedAt);
  if (t > baseline && (best === null || t > best.t)) best = { t: t, message: messages[i].message };
}
if (best === null) throw new Error('no new OTP recorded yet');
var match = /\b(\d{6})\b/.exec(best.message);
if (match === null) throw new Error('recorded OTP message has no 6-digit code');
output.otp = match[1];
