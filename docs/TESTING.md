# Demo environment verification

These checks use the seeded demo staff accounts and a disposable report imported through the real CSV route. They are intended for a local development environment only.

## Start the services

Start the normal development stack with demo mode enabled:

```powershell
docker compose up --build -d
```

The seeded demo orders are `DEMO-1001` through `DEMO-1009`. `DEMO-1001` is processing, `DEMO-1002` is ready but not sent, and the remaining orders demonstrate queued, sent, delivered, failed, link-opened, expired, and critical states. `DEMO-1001` through `DEMO-1003` are three fake family members sharing mobile `9000001001`. Staff demo accounts are created only when `DEMO_MODE=true` and a private
`DEMO_STAFF_PASSWORD` is configured in the local `.env` file.

For the expiry check, start the isolated test backend. It has its own freshly migrated and seeded database and enables the gated test clock:

```powershell
docker compose -p labportal-manual --profile e2e up --build -d e2e-backend
$Api = 'http://127.0.0.1:8001'
```

To use the browser UI with that backend, start Vite in another terminal:

```powershell
Set-Location frontend
$env:VITE_API_PROXY_TARGET = 'http://127.0.0.1:8001'
$env:VITE_DEMO_MODE = 'true'
npm run dev -- --host 127.0.0.1 --port 4174
```

For the normal Compose stack instead, set `$Api = 'http://127.0.0.1:8000'` and open `http://localhost:5173`.

## Common setup: staff login and ready order

Run in PowerShell. `curl.exe` is used explicitly to avoid PowerShell's `curl` alias.

```powershell
$StaffCookie = Join-Path $env:TEMP 'labportal-staff-cookies.txt'
$PatientCookie = Join-Path $env:TEMP 'labportal-patient-cookies.txt'
$CsvFile = Join-Path $env:TEMP 'labportal-ready-order.csv'
$JsonFile = Join-Path $env:TEMP 'labportal-import.json'
function Write-JsonPayload($Value) {
  $Path = Join-Path $env:TEMP 'labportal-request.json'
  $Json = $Value | ConvertTo-Json -Compress -Depth 8
  [IO.File]::WriteAllText($Path, $Json, [Text.UTF8Encoding]::new($false))
  return $Path
}
$Csv = @'
order_no,patient_name,mobile,parameter,value,unit,reference_range,flag,status,summary_en,summary_te,summary_hi
DOC-READY-001,Demo Import Patient,9000002001,Haemoglobin,10.2,g/dL,12.0-15.5,low,processing,Below the usual range.,సాధారణ పరిధి కంటే తక్కువ.,सामान्य सीमा से कम।
DOC-READY-001,Demo Import Patient,9000002001,Haemoglobin,10.2,g/dL,12.0-15.5,low,ready,Below the usual range.,సాధారణ పరిధి కంటే తక్కువ.,सामान्य सीमा से कम।
'@
[IO.File]::WriteAllText($CsvFile, $Csv, [Text.UTF8Encoding]::new($false))
[IO.File]::WriteAllText($JsonFile, (@{ csv = $Csv } | ConvertTo-Json -Compress), [Text.UTF8Encoding]::new($false))

$StaffEmail = 'staff@example.com'
$StaffPassword = Read-Host 'Enter the locally configured DEMO_STAFF_PASSWORD'
$LoginFile = Write-JsonPayload @{ email = $StaffEmail; password = $StaffPassword }
curl.exe -sS -i -c $StaffCookie -b $StaffCookie -H 'Content-Type: application/json' --data-binary "@$LoginFile" "$Api/api/staff/login"
curl.exe -sS -i -c $StaffCookie -b $StaffCookie -H 'Content-Type: application/json' --data-binary "@$JsonFile" "$Api/api/staff/import/csv"
curl.exe -sS -c $StaffCookie -b $StaffCookie "$Api/api/staff/orders"
curl.exe -sS -c $StaffCookie -b $StaffCookie "$Api/api/staff/outbox"
```

Expected results:

| Step | Expected result |
|---|---|
| Staff login | `200`; response has `user.email: staff@example.com` and sets an HttpOnly staff cookie. |
| CSV import | `200`; response says one order moved to Ready. |
| Orders | Contains `DOC-READY-001`, Demo Import Patient, and status `ready`. |
| Outbox | Contains a newest `report-link` notification, an SMS channel, masked recipient, queued status, and a `/r/<token>` body link. The response has at most 50 messages. |

`GET /api/staff/outbox` requires a front-desk or ops session. A pathologist session receives `403`; with `DEMO_MODE=false`, an authenticated request receives `404`. The route never returns an unmasked recipient.

For an actual multi-person family picker, import a second patient with the same mobile number:

```powershell
$FamilyCsv = @'
order_no,patient_name,mobile,parameter,value,unit,reference_range,flag,status
DOC-FAMILY-001,Demo Family Member D,9000002001,Glucose,90,mg/dL,70-100,normal,processing
DOC-FAMILY-001,Demo Family Member D,9000002001,Glucose,90,mg/dL,70-100,normal,ready
'@
[IO.File]::WriteAllText($JsonFile, (@{ csv = $FamilyCsv } | ConvertTo-Json -Compress), [Text.UTF8Encoding]::new($false))
curl.exe -sS -i -c $StaffCookie -b $StaffCookie -H 'Content-Type: application/json' --data-binary "@$JsonFile" "$Api/api/staff/import/csv"
```

Expected result: a successful import and a second patient/order attached to the same mobile account after that mobile verifies.

## Link, OTP, report, family picker, summary flag, and access log

Extract the link token created by the CSV transition, then validate it and request a link-bound OTP:

```powershell
$Outbox = curl.exe -sS -c $StaffCookie -b $StaffCookie "$Api/api/staff/outbox" | ConvertFrom-Json
$LinkBody = ($Outbox.messages | Where-Object purpose -eq 'report-link' | Where-Object { $_.body -match 'DOC-READY-001' } | Select-Object -First 1).body
$null = $LinkBody -match '/r/([A-Za-z0-9_-]+)'
$LinkToken = $Matches[1]
curl.exe -sS "$Api/r/$LinkToken"
$OtpRequestFile = Write-JsonPayload @{ mobile = '9876543210'; consent = $true; consent_version = 'dpdp-v1'; link_token = $LinkToken }
$OtpResponse = curl.exe -sS -c $PatientCookie -b $PatientCookie -H 'Content-Type: application/json' --data-binary "@$OtpRequestFile" "$Api/api/auth/otp/request" | ConvertFrom-Json
$ChallengeId = $OtpResponse.challenge_id
curl.exe -sS "$Api/api/auth/demo/outbox/$ChallengeId"
$DemoMessage = curl.exe -sS -c $StaffCookie -b $StaffCookie "$Api/api/staff/outbox" | ConvertFrom-Json
$OtpBody = ($DemoMessage.messages | Where-Object purpose -eq 'otp' | Select-Object -First 1).body
$null = $OtpBody -match '\b(\d{6})\b'
$Code = $Matches[1]
$VerifyFile = Write-JsonPayload @{ challenge_id = $ChallengeId; code = $Code }
curl.exe -sS -i -c $PatientCookie -b $PatientCookie -H 'Content-Type: application/json' --data-binary "@$VerifyFile" "$Api/api/auth/otp/verify"
curl.exe -sS -c $PatientCookie -b $PatientCookie "$Api/api/patient/patients"
```

Expected results:

| Step | Expected result |
|---|---|
| Link validation | `200` with `status: otp_required`; it does not disclose report contents. |
| OTP request | `202`, with a challenge ID and masked mobile. |
| Demo outbox | Contains the OTP body only in demo mode. The patient's verify screen displays the hint “Demo: code is in the outbox.” and never renders the code. |
| OTP verification | `200`; a patient session cookie is set. |
| Family picker | `GET /api/patient/patients` lists account-linked patients. The UI displays the picker for multiple patients and automatically skips it for one. |

List orders for a selected patient, then fetch the report and report a summary issue:

```powershell
$PatientId = ((curl.exe -sS -c $PatientCookie -b $PatientCookie "$Api/api/patient/patients") | ConvertFrom-Json).patients[0].id
$Orders = curl.exe -sS -c $PatientCookie -b $PatientCookie "$Api/api/patient/patients/$PatientId/orders" | ConvertFrom-Json
$OrderId = ($Orders.orders | Where-Object order_no -eq 'DOC-READY-001' | Select-Object -First 1).id
$Report = curl.exe -sS -c $PatientCookie -b $PatientCookie "$Api/api/patient/orders/${OrderId}?lang=en" | ConvertFrom-Json
$SummaryId = $Report.results[0].summary_id
$FlagFile = Write-JsonPayload @{ reason = 'Please review this explanation.' }
curl.exe -sS -i -c $PatientCookie -b $PatientCookie -H 'Content-Type: application/json' --data-binary "@$FlagFile" "$Api/api/summaries/$SummaryId/flag"
curl.exe -sS -c $StaffCookie -b $StaffCookie "$Api/api/staff/orders/$OrderId/access-logs"
```

Expected results:

| Step | Expected result |
|---|---|
| Patient orders | Includes `DOC-READY-001`, `ready`, and a non-null `signed_at`. |
| Report | Includes the Haemoglobin value, flag, reference range, and English summary. Add `?lang=te` to receive the Telugu summary without changing the order. |
| Summary flag | `200`; the response confirms the flag was accepted. The staff review queue lists the flagged summary and reason first. |
| Access log | Includes a `report_view` entry created by the report request. PDF downloads also create a log entry. |

## Wrong OTP and lockout after five attempts

Create a new OTP challenge using the request command above, then submit an incorrect code five times:

```powershell
$WrongRequestFile = Write-JsonPayload @{ mobile = '9000002001'; consent = $true; consent_version = 'dpdp-v1' }
$WrongOtp = curl.exe -sS -H 'Content-Type: application/json' --data-binary "@$WrongRequestFile" "$Api/api/auth/otp/request" | ConvertFrom-Json
$WrongChallengeId = $WrongOtp.challenge_id
$WrongBodyFile = Write-JsonPayload @{ challenge_id = $WrongChallengeId; code = '000000' }
1..5 | ForEach-Object {
  curl.exe -sS -i -c $PatientCookie -b $PatientCookie -H 'Content-Type: application/json' --data-binary "@$WrongBodyFile" "$Api/api/auth/otp/verify"
}
```

Expected result: attempts one through four return `401` with decreasing `attempts_remaining`; attempt five returns `429` with zero remaining attempts. Further verification of that challenge remains locked. In the UI, the wrong-code message shows the remaining attempts and the lockout message appears after the fifth error.

## Expired link

Use the isolated E2E backend (`$Api` set to port `8001`) and an unexpired report link from the CSV flow:

```powershell
$ClockAdvanceFile = Write-JsonPayload @{ hours = 73 }
curl.exe -sS -i -H 'Content-Type: application/json' -H 'X-E2E-Token: isocode-e2e-only-token' --data-binary "@$ClockAdvanceFile" "$Api/api/test/clock/advance"
curl.exe -sS -i "$Api/r/$LinkToken"
```

Expected result: link validation returns `410`; the browser shows “This link has expired” and offers “Get a new link with OTP.” The test clock is unavailable in the normal app configuration. Reset it after manual use:

```powershell
curl.exe -sS -i -H 'X-E2E-Token: isocode-e2e-only-token' -X POST "$Api/api/test/clock/reset"
```

## Critical result and callback

Import a CSV containing one critical result moved to Ready:

```powershell
$CriticalCsv = @'
order_no,patient_name,mobile,parameter,value,unit,reference_range,flag,status
DOC-CRITICAL-001,Critical Demo Patient,9000003001,Potassium,7.1,mEq/L,3.5-5.1,critical,processing
DOC-CRITICAL-001,Critical Demo Patient,9000003001,Potassium,7.1,mEq/L,3.5-5.1,critical,ready
'@
[IO.File]::WriteAllText($JsonFile, (@{ csv = $CriticalCsv } | ConvertTo-Json -Compress), [Text.UTF8Encoding]::new($false))
curl.exe -sS -i -c $StaffCookie -b $StaffCookie -H 'Content-Type: application/json' --data-binary "@$JsonFile" "$Api/api/staff/import/csv"
curl.exe -sS -c $StaffCookie -b $StaffCookie "$Api/api/staff/callback-tasks"
curl.exe -sS -c $StaffCookie -b $StaffCookie "$Api/api/staff/outbox"

$CriticalOutbox = curl.exe -sS -c $StaffCookie -b $StaffCookie "$Api/api/staff/outbox" | ConvertFrom-Json
$CriticalLinkBody = ($CriticalOutbox.messages | Where-Object { $_.purpose -eq 'report-link' -and $_.body -match 'DOC-CRITICAL-001' } | Select-Object -First 1).body
$null = $CriticalLinkBody -match '/r/([A-Za-z0-9_-]+)'
$CriticalLinkToken = $Matches[1]
$CriticalOtpFile = Write-JsonPayload @{ mobile = '9000003001'; consent = $true; consent_version = 'dpdp-v1'; link_token = $CriticalLinkToken }
$CriticalOtp = curl.exe -sS -c $PatientCookie -b $PatientCookie -H 'Content-Type: application/json' --data-binary "@$CriticalOtpFile" "$Api/api/auth/otp/request" | ConvertFrom-Json
$CriticalCode = (curl.exe -sS "$Api/api/auth/demo/outbox/$($CriticalOtp.challenge_id)" | ConvertFrom-Json).code
$CriticalVerifyFile = Write-JsonPayload @{ challenge_id = $CriticalOtp.challenge_id; code = $CriticalCode }
curl.exe -sS -i -c $PatientCookie -b $PatientCookie -H 'Content-Type: application/json' --data-binary "@$CriticalVerifyFile" "$Api/api/auth/otp/verify"
$CriticalPatients = curl.exe -sS -c $PatientCookie -b $PatientCookie "$Api/api/patient/patients" | ConvertFrom-Json
$CriticalPatientId = ($CriticalPatients.patients | Where-Object name -eq 'Critical Demo' | Select-Object -First 1).id
$CriticalOrders = curl.exe -sS -c $PatientCookie -b $PatientCookie "$Api/api/patient/patients/$CriticalPatientId/orders" | ConvertFrom-Json
$CriticalOrderId = ($CriticalOrders.orders | Where-Object order_no -eq 'DOC-CRITICAL-001' | Select-Object -First 1).id
$CriticalReport = curl.exe -sS -c $PatientCookie -b $PatientCookie "$Api/api/patient/orders/$CriticalOrderId" | ConvertFrom-Json
$CriticalReport.results | Select-Object name, value, unit, reference_range, summary, flag
```

Expected result: the callback task list contains `DOC-CRITICAL-001`; the outbox includes a `callback-notice`; OTP verification succeeds; the critical report response has null `value`, `unit`, `reference_range`, and `summary`. In the UI, the calm contact-the-lab card appears without the critical value.

## Browser checks and responsive layout

1. Sign in at `/staff` with `staff@example.com` and the private password configured in `.env`.
2. Import the CSV above using **Import lab results**. Confirm the order is Ready and its report-link appears under **Outbox**.
3. Use **Copy link** in the outbox. Open the copied link, request an OTP for the matching mobile, and read the code in the staff outbox (not on the patient page).
4. Verify the OTP, choose the patient if the account has multiple linked patients, and open the report.
5. Switch the report language to Telugu, submit **Report a problem with this summary**, then confirm the reason appears first in the staff review queue.
6. Open that order's action menu and choose **Access log**; confirm a `report_view` entry.
7. Check the critical result workflow above and the expired-link flow in the isolated E2E stack.
8. Run `npm run test:e2e` from `frontend`. The responsive suite checks all declared patient, staff, and styleguide routes at 320, 360, 390, 768, 1024, and 1440 pixels in each theme. It fails on viewport overflow or overlapping visible siblings in navigation/table rows.

Stop the isolated test stack when done:

```powershell
docker compose -p labportal-manual --profile e2e down --volumes --remove-orphans
```
