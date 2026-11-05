PYTHON := python
BACKEND := backend
FRONTEND := frontend

.PHONY: install-backend install-frontend test-backend test-frontend run-backend run-frontend

install-backend:
	$(PYTHON) -m pip install -r $(BACKEND)/requirements.txt

install-frontend:
	cd $(FRONTEND) && npm install

test-backend:
	cd $(BACKEND) && pytest -q

test-frontend:
	cd $(FRONTEND) && npm run test -- --run

run-backend:
	cd $(BACKEND) && uvicorn app.main:app --reload --host 0.0.0.0 --port 8000

run-frontend:
	cd $(FRONTEND) && npm run dev -- --host 0.0.0.0
