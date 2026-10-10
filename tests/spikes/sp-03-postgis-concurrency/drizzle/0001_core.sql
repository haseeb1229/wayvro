CREATE TABLE "assignments" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"ride_id" bigint NOT NULL,
	"driver_id" bigint NOT NULL,
	"offer_id" bigint,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assignments_status_chk" CHECK ("assignments"."status" in ('ACTIVE','ENDED'))
);
--> statement-breakpoint
CREATE TABLE "driver_presence" (
	"driver_id" bigint PRIMARY KEY NOT NULL,
	"geog" "geography" NOT NULL,
	"online" boolean NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	"vehicle_class" smallint NOT NULL,
	"restricted" boolean DEFAULT false NOT NULL,
	"busy" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "offers" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"ride_id" bigint NOT NULL,
	"driver_id" bigint NOT NULL,
	"status" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "offers_status_chk" CHECK ("offers"."status" in ('OFFERED','ACCEPTED','EXPIRED','REJECTED'))
);
--> statement-breakpoint
CREATE TABLE "ride_requests" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"status" text NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ride_requests_status_chk" CHECK ("ride_requests"."status" in ('SEARCHING','ASSIGNED','CANCELLED'))
);
--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_ride_id_ride_requests_id_fk" FOREIGN KEY ("ride_id") REFERENCES "public"."ride_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_offer_id_offers_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."offers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offers" ADD CONSTRAINT "offers_ride_id_ride_requests_id_fk" FOREIGN KEY ("ride_id") REFERENCES "public"."ride_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "assignments_one_active_per_ride" ON "assignments" USING btree ("ride_id") WHERE status = 'ACTIVE';--> statement-breakpoint
CREATE UNIQUE INDEX "assignments_one_active_per_driver" ON "assignments" USING btree ("driver_id") WHERE status = 'ACTIVE';--> statement-breakpoint
CREATE INDEX "driver_presence_geog_gist" ON "driver_presence" USING gist ("geog");--> statement-breakpoint
CREATE INDEX "driver_presence_online_class_idx" ON "driver_presence" USING btree ("vehicle_class") WHERE online and not restricted and not busy;--> statement-breakpoint
CREATE INDEX "offers_ride_idx" ON "offers" USING btree ("ride_id");