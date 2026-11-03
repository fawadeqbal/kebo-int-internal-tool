import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:kebo_app/core/json.dart';
import 'package:kebo_app/ds/ds.dart';

import '../support/harness.dart';

void main() {
  testWidgets('search on the phone keeps what was typed and filters the rows', (tester) async {
    final rows = [for (final n in ['SO-2026-0001', 'SO-2026-0127', 'SO-2026-0130']) n];
    await pumpScreen(
      tester,
      ListFrame<String>(
        title: 'Orders',
        searchHint: 'Search',
        localSearch: true,
        load: (api, q, page) async => Paged.all(rows),
        row: (x) => RowData(title: x),
      ),
      const {},
    );
    expect(find.text('SO-2026-0001'), findsOneWidget);
    await tester.enterText(find.byType(TextField), '0127');
    await tester.pump(const Duration(milliseconds: 400));
    await tester.pumpAndSettle();
    expect(find.text('0127'), findsOneWidget, reason: 'the typed text stays');
    expect(find.text('SO-2026-0127'), findsOneWidget);
    expect(find.text('SO-2026-0001'), findsNothing);
  });
}
