.PHONY: demo-reset

demo-reset:
	KAUNTER_ALLOW_DEMO_RESET=1 npm run demo:reset -- --workspace demo --seed msme-aircon-v1 --confirm RESET_DEMO
