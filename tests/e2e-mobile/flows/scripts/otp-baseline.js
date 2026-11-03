// Maestro runScript (GraalJS, host side): remembers the newest OTP message already recorded for PHONE before the flow
// asks for a new code, so otp-code.js never reuses an older code. Reads the LOCAL-RUNNER-ONLY /__local/otp-inbox
// (ADR-045; absent from release artefacts — ART-ISO). No master or fixed code exists anywhere.
var res = http.get(API + '/__local/otp-inbox?phone=' + encodeURIComponent(PHONE));
if (!res.ok) throw new Error('otp inbox unavailable: HTTP ' + res.status);
var messages = json(res.body).messages;
var newest = 0;
for (var i = 0; i < messages.length; i++) {
  var t = Date.parse(messages[i].recordedAt);
  if (t > newest) newest = t;
}
output.otpBaseline = String(newest);
