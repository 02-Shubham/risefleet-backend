.PHONY: setup up down seed dev build start test-load

setup:
	npm install
	npx prisma generate

up:
	docker-compose up -d

down:
	docker-compose down

push-db:
	npx prisma db push

seed:
	npm run prisma:seed

dev:
	npm run dev

build:
	npm run build

start:
	npm run start

test-load:
	npm run test:load
