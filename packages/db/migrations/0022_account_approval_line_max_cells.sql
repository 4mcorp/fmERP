-- feature: org
ALTER TABLE "account" ADD COLUMN "approval_line_max_cells" integer DEFAULT 15 NOT NULL;--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_approval_line_max_cells_range" CHECK ("account"."approval_line_max_cells" between 2 and 30);