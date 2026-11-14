-- Every notification keeps its whole message (what happened, where, who, money, what to do next), so the web
-- and the phone can show it in full; title and body stay its short form.
ALTER TABLE "notifications" ADD COLUMN "message" JSONB;
