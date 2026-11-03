// Pictures of the line screens with 120 lines, in the app's own font (run with --update-goldens).
// Tagged "shots": not part of the normal run.
@Tags(['shots'])
library;

import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:kebo_app/custom/order_lines.dart';
import 'package:kebo_app/ds/ds.dart';

import '../ds/line_list_test.dart' show lines120;
import '../support/harness.dart';

Future<void> _fonts() async {
  final inter = FontLoader('Inter');
  for (final w in ['Regular', 'Medium', 'SemiBold', 'Bold']) {
    inter.addFont(Future.value(ByteData.sublistView(File('assets/fonts/Inter-$w.ttf').readAsBytesSync())));
  }
  await inter.load();
  final icons = FontLoader('MaterialIcons');
  final sdk = Platform.environment['FLUTTER_ROOT'] ?? '/home/claude/flutter-sdk';
  icons.addFont(Future.value(ByteData.sublistView(File('$sdk/bin/cache/artifacts/material_fonts/MaterialIcons-Regular.otf').readAsBytesSync())));
  await icons.load();
}

void main() {
  setUpAll(_fonts);

  Future<void> shot(WidgetTester tester, String name) async {
    await tester.pumpAndSettle();
    await expectLater(find.byType(MaterialApp), matchesGoldenFile('out/$name.png'));
  }

  final lines = lines120()
    ..[4]['description'] = 'PVC film roll 250 mm'
    ..[5]['description'] = 'Aluminium foil roll 250 mm';

  testWidgets('goods received', (tester) async {
    await pumpSheet(tester, (c) => openGoodsReceived(c, 'o1', 'SO-2026-0447', lines));
    final box = find.descendant(of: find.bySemanticsLabel(RegExp(r'^Received for line 4,')), matching: find.byType(EditableText));
    await tester.enterText(box, '38');
    await shot(tester, 'l1-received');
  });

  testWidgets('packing sheet', (tester) async {
    await pumpSheet(tester, (c) => openPacking(c, 'o1', 'SO-2026-0447', lines));
    await tester.tap(find.text('PVC film roll 250 mm'));
    await tester.pumpAndSettle();
    await tester.enterText(find.descendant(of: find.byType(BottomSheet), matching: find.byType(TextField)).first, '4');
    await shot(tester, 'l2-packing');
  });

  testWidgets('items editor', (tester) async {
    await pumpSheet(tester, (c) async {
      await openItems(c,
          items: [
            for (var i = 1; i <= 120; i++) {'id': 'i$i', 'description': 'Item number $i', 'quantity': '4', 'unit': 'pcs'},
            {'_key': 'p1', '_parent': 'i2', 'description': 'A part of item 2', 'quantity': '10', 'unit': 'pcs'},
          ],
          fields: const [FieldDef('description', 'What', FieldKind.text, required: true)],
          blank: () => {});
      return false;
    });
    await shot(tester, 'l3-items');
  });
}
