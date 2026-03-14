install:
	pnpm install

dev:
	pnpm dev

build:
	pnpm build

test:
	pnpm test

lint:
	pnpm lint

typecheck:
	pnpm typecheck

db:migrate:
	pnpm db:migrate

db:seed:
	pnpm db:seed

docker:up:
	docker compose up --build

docker:down:
	docker compose down
