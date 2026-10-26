import 'package:flutter_test/flutter_test.dart';
import 'package:kebo_rfq/core/format.dart';
import 'package:kebo_rfq/core/labels.dart';
import 'package:kebo_rfq/features/more/notifications.dart';

void main() {
  test('line totals match the server (cents, rounded per line, discount capped, tax on taxable)', () {
    final t = lineTotals([(quantity: '2', unitPrice: '23500'), (quantity: '1', unitPrice: '2800')], '300', '0');
    expect(t.subtotal, 4980000);
    expect(t.discount, 30000);
    expect(t.total, 4950000);
    final taxed = lineTotals([(quantity: '3', unitPrice: '10.335')], '0', '17');
    expect(taxed.lines.first, 3102); // same as the server's calculateTotals()
    expect(taxed.tax, 527);
    expect(lineTotals([(quantity: '1', unitPrice: '10')], '50', '0').total, 0); // discount never exceeds subtotal
  });

  test('money and dates format like the web', () {
    expect(money('49500', 'USD'), 'USD 49,500.00');
    expect(date('2026-10-24'), '24 Oct 2026');
    expect(duration(3 * 3600000 + 20 * 60000), '3h 20m');
    expect(duration(2 * 86400000 + 4 * 3600000), '2d 4h');
  });

  test('overdue is derived from the due date', () {
    expect(invoiceDisplayStatus({'status': 'unpaid', 'dueDate': '2026-01-01'}, '2026-10-24'), 'overdue');
    expect(invoiceDisplayStatus({'status': 'paid', 'dueDate': '2026-01-01'}, '2026-10-24'), 'paid');
  });

  test('notification links open the right screen', () {
    expect(appRoute('/queries/abc'), '/inquiries/abc');
    expect(appRoute('https://rfq.fawadiqbal.dev/invoices/x'), '/invoices/x');
    expect(appRoute('/settings'), isNull);
  });
}
