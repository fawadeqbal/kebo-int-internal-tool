import 'package:flutter_test/flutter_test.dart';
import 'package:kebo_rfq/core/api.dart';
import 'package:kebo_rfq/core/format.dart';
import 'package:kebo_rfq/features/more/notifications.dart';

void main() {
  test('money and dates format like the web', () {
    expect(money('49500', 'USD'), 'USD 49,500.00');
    expect(minor(3038939, 'USD'), 'USD 30,389.39');
    expect(date('2026-10-24'), '24 Oct 2026');
    expect(duration(3 * 3600000 + 20 * 60000), '3h 20m');
    expect(duration(2 * 86400000 + 4 * 3600000), '2d 4h');
  });

  test('step lateness reads like a person would say it', () {
    expect(dueIn(0), 'today');
    expect(dueIn(3), 'in 3 days');
    expect(dueIn(-10), '10 days late');
    expect(dueIn(-1), '1 day late');
  });

  test('push and notification links open the right screen', () {
    expect(appRoute('/deals/abc'), '/deals/abc');
    expect(appRoute('/orders/xyz'), '/orders/xyz');
    expect(appRoute('https://rfq.fawadiqbal.dev/orders/196f4272-f93c-473a-a489-1d5b716b9600'), '/orders/196f4272-f93c-473a-a489-1d5b716b9600');
    expect(appRoute('https://kebo.example.com/deals/abc/quotation'), '/deals/abc/quotation');
    expect(appRoute('/inquiries/abc'), '/deals/abc');
    expect(appRoute('/settings'), isNull);
    expect(appRoute(null), isNull);
  });

  test('server errors keep their code, field messages and duplicate matches', () {
    final dup = Api.errorFromBody(409, {
      'error': 'A customer with the same email or phone already exists. Use it, or save anyway.',
      'code': 'duplicate',
      'matches': [
        {'id': 'c1', 'label': 'Al-Shifa Pharma Ltd', 'detail': 'Ibrahim Musa'},
      ],
    });
    expect(dup.duplicate, isTrue);
    expect(dup.matches.single['label'], 'Al-Shifa Pharma Ltd');

    final warn = Api.errorFromBody(409, {'error': 'The deposit (USD 2,411.64) has not been received yet.', 'code': 'confirm'});
    expect(warn.needsConfirm, isTrue);
    expect(warn.message, 'The deposit (USD 2,411.64) has not been received yet.');
    expect(warn.duplicate, isFalse);
    final refused = Api.errorFromBody(409, {'error': 'An order moves one stage at a time: from Confirmed it can go to In production.', 'code': 'not_next_or_previous'});
    expect(refused.needsConfirm, isFalse);

    final invalid = Api.errorFromBody(422, {
      'error': 'Choose why the deal was lost',
      'fieldErrors': {
        'lostReason': ['Choose why the deal was lost'],
      },
    });
    expect(invalid.field('lostReason'), 'Choose why the deal was lost');
  });

  test('a server address typed with /api still works', () {
    expect(Api.normalizeServer('http://localhost:4104/api/'), 'http://localhost:4104');
    expect(Api.normalizeServer('https://kebo.example.com'), 'https://kebo.example.com');
  });
}
