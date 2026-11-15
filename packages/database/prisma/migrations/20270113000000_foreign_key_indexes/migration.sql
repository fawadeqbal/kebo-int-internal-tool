-- An index for every foreign key that had none (42). Joins on them (a quotation's lines to the factory's lines, an
-- order line to its quotation line, an inquiry to its contact…) and the checks Postgres makes when a record is
-- removed (a person, a contact, a session) no longer read the whole table: speed as the data grows. The tables are
-- small today, so each index is built in a moment. A test keeps it so: every foreign key has an index.

-- CreateIndex
CREATE INDEX "allocations_recorded_by_idx" ON "allocations"("recorded_by");

-- CreateIndex
CREATE INDEX "attachments_uploaded_by_idx" ON "attachments"("uploaded_by");

-- CreateIndex
CREATE INDEX "audit_logs_user_id_idx" ON "audit_logs"("user_id");

-- CreateIndex
CREATE INDEX "companies_plan_id_idx" ON "companies"("plan_id");

-- CreateIndex
CREATE INDEX "device_tokens_session_id_idx" ON "device_tokens"("session_id");

-- CreateIndex
CREATE INDEX "expenses_paid_by_idx" ON "expenses"("paid_by");

-- CreateIndex
CREATE INDEX "expenses_recorded_by_idx" ON "expenses"("recorded_by");

-- CreateIndex
CREATE INDEX "factory_quote_lines_requested_item_id_idx" ON "factory_quote_lines"("requested_item_id");

-- CreateIndex
CREATE INDEX "factory_quotes_created_by_idx" ON "factory_quotes"("created_by");

-- CreateIndex
CREATE INDEX "factory_requests_created_by_idx" ON "factory_requests"("created_by");

-- CreateIndex
CREATE INDEX "factory_requests_factory_quote_id_idx" ON "factory_requests"("factory_quote_id");

-- CreateIndex
CREATE INDEX "follow_ups_assignee_id_idx" ON "follow_ups"("assignee_id");

-- CreateIndex
CREATE INDEX "follow_ups_done_by_idx" ON "follow_ups"("done_by");

-- CreateIndex
CREATE INDEX "inquiries_contact_id_idx" ON "inquiries"("contact_id");

-- CreateIndex
CREATE INDEX "inquiries_created_by_idx" ON "inquiries"("created_by");

-- CreateIndex
CREATE INDEX "inquiry_assignments_assigned_by_idx" ON "inquiry_assignments"("assigned_by");

-- CreateIndex
CREATE INDEX "inquiry_assignments_assignee_id_idx" ON "inquiry_assignments"("assignee_id");

-- CreateIndex
CREATE INDEX "inquiry_stage_changes_changed_by_idx" ON "inquiry_stage_changes"("changed_by");

-- CreateIndex
CREATE INDEX "leads_company_id_idx" ON "leads"("company_id");

-- CreateIndex
CREATE INDEX "money_movements_paid_by_idx" ON "money_movements"("paid_by");

-- CreateIndex
CREATE INDEX "money_movements_recorded_by_idx" ON "money_movements"("recorded_by");

-- CreateIndex
CREATE INDEX "money_submissions_decided_by_idx" ON "money_submissions"("decided_by");

-- CreateIndex
CREATE INDEX "notes_author_id_idx" ON "notes"("author_id");

-- CreateIndex
CREATE INDEX "notes_contact_id_idx" ON "notes"("contact_id");

-- CreateIndex
CREATE INDEX "order_bank_steps_allocation_id_idx" ON "order_bank_steps"("allocation_id");

-- CreateIndex
CREATE INDEX "order_deliveries_sat_engineer_idx" ON "order_deliveries"("sat_engineer");

-- CreateIndex
CREATE INDEX "order_documents_attachment_id_idx" ON "order_documents"("attachment_id");

-- CreateIndex
CREATE INDEX "order_documents_paper_id_idx" ON "order_documents"("paper_id");

-- CreateIndex
CREATE INDEX "order_documents_shipment_id_idx" ON "order_documents"("shipment_id");

-- CreateIndex
CREATE INDEX "order_factories_fat_attended_by_idx" ON "order_factories"("fat_attended_by");

-- CreateIndex
CREATE INDEX "order_lines_quote_line_id_idx" ON "order_lines"("quote_line_id");

-- CreateIndex
CREATE INDEX "order_papers_made_by_idx" ON "order_papers"("made_by");

-- CreateIndex
CREATE INDEX "order_stage_changes_by_idx" ON "order_stage_changes"("by");

-- CreateIndex
CREATE INDEX "orders_created_by_idx" ON "orders"("created_by");

-- CreateIndex
CREATE INDEX "parties_created_by_idx" ON "parties"("created_by");

-- CreateIndex
CREATE INDEX "person_targets_updated_by_idx" ON "person_targets"("updated_by");

-- CreateIndex
CREATE INDEX "purchase_orders_sent_by_idx" ON "purchase_orders"("sent_by");

-- CreateIndex
CREATE INDEX "quotation_revisions_created_by_idx" ON "quotation_revisions"("created_by");

-- CreateIndex
CREATE INDEX "quote_lines_factory_quote_line_id_idx" ON "quote_lines"("factory_quote_line_id");

-- CreateIndex
CREATE INDEX "quote_lines_requested_item_id_idx" ON "quote_lines"("requested_item_id");

-- CreateIndex
CREATE INDEX "request_keys_user_id_idx" ON "request_keys"("user_id");

-- CreateIndex
CREATE INDEX "sales_targets_updated_by_idx" ON "sales_targets"("updated_by");

