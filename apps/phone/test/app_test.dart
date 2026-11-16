import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:rfq_desk/app/app.dart';
import 'package:rfq_desk/design/design.dart';

void main() {
  setUp(() {
    KHaptics.enabled = false;
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger.setMockMethodCallHandler(
      const MethodChannel('dev.fluttercommunity.plus/package_info'),
      (call) async => {
        'appName': 'RFQ Desk',
        'packageName': 'dev.fawadiqbal.rfqdesk',
        'version': '3.0.0-alpha.1',
        'buildNumber': '3000001',
      },
    );
  });

  testWidgets('the app opens on the design gallery and switches theme', (t) async {
    await t.pumpWidget(const ProviderScope(child: RfqDeskApp()));
    await t.pump(const Duration(milliseconds: 100));
    expect(find.text('Kestrel · design gallery'), findsOneWidget);
    await t.tap(find.bySemanticsLabel(RegExp('Switch to (dark|light)')));
    await t.pump(const Duration(milliseconds: 100));
    expect(t.takeException(), isNull);
  });
}
