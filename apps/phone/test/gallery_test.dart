import 'package:flutter/widgets.dart';
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
      (call) async => {'appName': 'RFQ Desk', 'packageName': 'x', 'version': '3.0.0-alpha.2', 'buildNumber': '3000002'},
    );
  });

  testWidgets('gallery opens the patterns page and the stepped form', (t) async {
    t.view.physicalSize = const Size(390 * 3, 844 * 3);
    t.view.devicePixelRatio = 3;
    addTearDown(t.view.reset);
    await t.pumpWidget(const ProviderScope(child: RfqDeskApp()));
    await t.pump(const Duration(milliseconds: 100));
    await t.tap(find.text('Open screens and patterns'));
    await t.pumpAndSettle();
    expect(find.text('Tablet press, 35 stations'), findsOneWidget);
    expect(t.takeException(), isNull);
    await t.scrollUntilVisible(find.text('Stepped form'), 400, scrollable: find.byType(Scrollable).first);
    await t.drag(find.byType(Scrollable).first, const Offset(0, -300)); // clear the tab bar
    await t.pumpAndSettle();
    await t.tap(find.text('Stepped form'));
    await t.pumpAndSettle();
    expect(find.text('Who paid'), findsWidgets);
    expect(t.takeException(), isNull);
  });
}
