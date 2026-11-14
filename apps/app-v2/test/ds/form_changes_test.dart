import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:kebo_app/ds/ds.dart';

import '../support/harness.dart';

void main() {
  testWidgets('a form asks "Discard changes?" only when something is really changed', (tester) async {
    await pumpSheet(
      tester,
      (context) => FormSheet.open(
        context,
        title: 'Edit customer',
        save: 'Save',
        groups: const [
          FormGroup(fields: [FieldDef('name', 'Name', FieldKind.text), FieldDef('city', 'City', FieldKind.text)]),
        ],
        initial: const {'name': 'Lahore Pharma', 'city': null},
        send: (api, body) async => null,
      ),
    );
    expect(find.text('Edit customer'), findsOneWidget);

    // Something typed: closing asks; Cancel keeps the form.
    await tester.enterText(find.byType(TextField).first, 'Lahore Pharma Ltd');
    await tester.pumpAndSettle();
    await tester.tap(find.byTooltip('Close'));
    await tester.pumpAndSettle();
    expect(find.text('Discard changes?'), findsOneWidget);
    await tester.tap(find.text('Cancel'));
    await tester.pumpAndSettle();
    expect(find.text('Edit customer'), findsOneWidget);

    // Put back as it was (and an empty field left empty): nothing changed, so it closes at once.
    await tester.enterText(find.byType(TextField).first, 'Lahore Pharma');
    await tester.enterText(find.byType(TextField).at(1), 'x');
    await tester.enterText(find.byType(TextField).at(1), '');
    await tester.pumpAndSettle();
    await tester.tap(find.byTooltip('Close'));
    await tester.pumpAndSettle();
    expect(find.text('Discard changes?'), findsNothing);
    expect(find.text('Edit customer'), findsNothing);
  });
}
