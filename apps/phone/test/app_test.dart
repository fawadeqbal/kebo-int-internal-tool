import 'package:flutter/services.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:rfq_desk/app/app.dart';
import 'package:rfq_desk/core/bell.dart';
import 'package:rfq_desk/app/router.dart';
import 'package:rfq_desk/core/providers.dart';
import 'package:rfq_desk/design/design.dart';

import 'support/fake_server.dart';

void main() {
  setUp(() {
    KHaptics.enabled = false;
    Bell.autoRefresh = false;
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger.setMockMethodCallHandler(
      const MethodChannel('dev.fluttercommunity.plus/package_info'),
      (call) async => {'appName': 'RFQ Desk', 'packageName': 'x', 'version': '3.0.0-alpha.3', 'buildNumber': '3000003'},
    );
  });

  testWidgets('the design gallery opens, switches theme, and leads to the patterns and the stepped form', (t) async {
    t.view.physicalSize = const Size(390 * 3, 844 * 3);
    t.view.devicePixelRatio = 3;
    addTearDown(t.view.reset);
    final (s, _) = signedOutSession({});
    addTearDown(s.api.net.stop);
    final container = ProviderContainer(overrides: [sessionProvider.overrideWith((ref) => s)]);
    addTearDown(container.dispose);
    await t.pumpWidget(UncontrolledProviderScope(container: container, child: const RfqDeskApp()));
    container.read(routerProvider).go('/gallery');
    await t.pumpAndSettle();
    expect(find.text('Kestrel · design gallery'), findsOneWidget);
    await t.tap(find.bySemanticsLabel(RegExp('Switch to (dark|light)')));
    await t.pump(const Duration(milliseconds: 100));
    await t.tap(find.text('Open screens and patterns'));
    await t.pumpAndSettle();
    expect(find.text('Tablet press, 35 stations'), findsOneWidget);
    await t.scrollUntilVisible(find.text('Stepped form'), 400, scrollable: find.byType(Scrollable).first);
    await t.drag(find.byType(Scrollable).first, const Offset(0, -300)); // clear the tab bar
    await t.pumpAndSettle();
    await t.tap(find.text('Stepped form'));
    await t.pumpAndSettle();
    expect(find.text('Paid by'), findsWidgets);
    expect(t.takeException(), isNull);
    expect(GoRouter.of(t.element(find.text('Paid by').first)), isNotNull);
  });
}
