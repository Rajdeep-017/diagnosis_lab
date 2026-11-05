# Assumptions

1. The system treats a patient's mobile number as the identity anchor and stores only encrypted mobile data in the backend. A separate consent record is created before OTP issuance.
2. Critical lab values do not expose any textual summary to the patient; they trigger a callback task and show a neutral lab contact message instead.
3. The report link is generated per order and bound to the patient account after successful OTP verification. The route is protected by account scoping and the order's patient relationship.
4. The AI summary layer is used only for non-critical, out-of-range results. It never decides the flag; flagging comes from deterministic reference-range logic.
5. Telugu and Hindi wording is intentionally labeled as requiring clinical review in the documentation because it is generated for readability, not validated by a clinician.
6. The monorepo is implemented as a modular monolith to reduce delivery time without compromising the option to split later into microservices.
7. The CSV ingest layer is designed to be idempotent on `order_no` and resilient to malformed rows so that a single invalid row does not abort the whole import.
8. The sample data is synthetic and does not reflect real patient data.
9. Token hashing uses SHA-256 and only the hash is stored; the server never stores raw sign-off tokens in the database.
10. The front-end initially targets mobile-first presentation for patient flows and desktop-first staff workflows while preserving responsive behavior.
