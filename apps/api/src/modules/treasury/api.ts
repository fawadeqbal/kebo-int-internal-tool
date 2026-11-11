/**
 * What other modules may use of Treasury (architecture review §5.3, §7.2): Treasury owns money accounts, payment
 * entries (money_movements) and what they pay (allocations); nobody else writes them. Other modules ask through
 * this file: the customer's credit, releasing a cancelled order's money and keeping it as a fee or paying it back,
 * and checking an account. The Nest services others inject (CustomerPaymentsService for approvals, CashService
 * for Insights, PaymentFilesService for the order's files) are exported by the Treasury module.
 */
export { creditOf, creditsAll, fromCredit, refund, releaseOrder } from "./customer-money";
export { checkAccount } from "./account-check";
export { fileView } from "./payment-file-view";
