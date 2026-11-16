import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:rfq_desk/design/design.dart';

Widget host(Widget child, {bool dark = false}) => MaterialApp(
  theme: KTheme.light(),
  darkTheme: KTheme.dark(),
  themeMode: dark ? ThemeMode.dark : ThemeMode.light,
  home: Scaffold(body: SingleChildScrollView(child: child)),
);

void main() {
  setUp(() => KHaptics.enabled = false);

  testWidgets('KTextField: label stays visible, error is announced and replaces help', (t) async {
    await t.pumpWidget(host(const KTextField(label: 'Amount', help: 'Before bank charges', error: 'Enter an amount')));
    expect(find.text('Amount'), findsOneWidget);
    expect(find.text('Enter an amount'), findsOneWidget);
    expect(find.text('Before bank charges'), findsNothing);
    expect(find.bySemanticsLabel(RegExp('Amount, error: Enter an amount')), findsOneWidget);
  });

  testWidgets('KCheckbox, KSwitch, KRadio toggle from the whole row', (t) async {
    var box = false, sw = false;
    String? pick;
    await t.pumpWidget(
      host(
        StatefulBuilder(
          builder: (c, set) => Column(
            children: [
              KCheckbox(label: 'Bank contract', value: box, onChanged: (v) => set(() => box = v)),
              KSwitch(label: 'Email the customer', value: sw, onChanged: (v) => set(() => sw = v)),
              KRadio<String>(label: 'Cash', value: 'Cash', group: pick, onChanged: (v) => set(() => pick = v)),
            ],
          ),
        ),
      ),
    );
    await t.tap(find.text('Bank contract'));
    await t.tap(find.text('Email the customer'));
    await t.tap(find.text('Cash'));
    await t.pumpAndSettle();
    expect((box, sw, pick), (true, true, 'Cash'));
    expect(t.getSize(find.byType(KCheckbox)).height, greaterThanOrEqualTo(KSize.touch));
  });

  testWidgets('KDetail says "Not set" for empty values and tags internal fields', (t) async {
    await t.pumpWidget(
      host(const KDetails(items: [KDetail('Customer reference', null), KDetail('Margin', '17.8%', internal: true)])),
    );
    expect(find.text(KDetail.notSet), findsOneWidget);
    expect(find.text('Internal'), findsOneWidget);
  });

  testWidgets('KSteps names where the record stands', (t) async {
    await t.pumpWidget(
      host(
        const KSteps(
          steps: [('Confirmed', KStepState.done), ('Customs', KStepState.blocked), ('Delivered', KStepState.todo)],
        ),
      ),
    );
    expect(find.bySemanticsLabel('Step 2 of 3: Customs, blocked'), findsOneWidget);
  });

  testWidgets('KAppHeader: stale figures look stale; bell is read with its count', (t) async {
    await t.pumpWidget(
      host(
        const KAppHeader(
          company: 'Kebo International',
          title: 'Orders',
          sync: KSyncState.offline('8:42'),
          userName: 'Fawad Iqbal',
          userRole: 'Owner',
          unread: 4,
        ),
      ),
    );
    expect(find.text('Offline · 8:42'), findsOneWidget);
    expect(find.bySemanticsLabel('Notifications, 4 new'), findsOneWidget);
    expect(find.bySemanticsLabel('Your account: Fawad Iqbal, Owner'), findsOneWidget);
  });

  testWidgets('KRecordHeader shows type and number, figures and last change', (t) async {
    await t.pumpWidget(
      host(
        const KRecordHeader(
          type: 'Sales order',
          number: 'SO-2026-0035',
          title: 'Tablet press',
          figures: [KFigure('Total', 'USD 48,200')],
          updated: 'Updated 8 Nov by Bilal',
        ),
      ),
    );
    expect(find.text('Sales order · SO-2026-0035'), findsOneWidget);
    expect(find.text('USD 48,200'), findsOneWidget);
    expect(find.text('Updated 8 Nov by Bilal'), findsOneWidget);
  });

  testWidgets('KFileField: one proof turns Add into Replace; failures offer Try again', (t) async {
    await t.pumpWidget(
      host(KFileField(label: 'Payment proof', files: const [], onChooseFile: () {}, onTakePhoto: () {})),
    );
    expect(find.text('Choose file'), findsOneWidget);
    expect(find.text('Optional'.padLeft(10)), findsOneWidget);
    await t.pumpWidget(
      host(
        KFileField(
          label: 'Payment proof',
          files: const [KFileItem(name: 'slip.jpg', bytes: 2048, error: 'No connection')],
          onChooseFile: () {},
          onRetry: (_) {},
        ),
      ),
    );
    expect(find.text('Replace'), findsOneWidget);
    expect(find.text('Try again'), findsOneWidget);
    expect(find.text('Failed: No connection'), findsOneWidget);
    expect(KFileItem.size(1840000), '1.8 MB');
  });

  testWidgets('KStepForm: validates, keeps input on Back, reviews, submits', (t) async {
    final ctrl = TextEditingController();
    var sent = false;
    await t.pumpWidget(
      MaterialApp(
        theme: KTheme.light(),
        home: Scaffold(
          body: KStepForm(
            submitLabel: 'Send',
            onSubmit: () async => sent = true,
            steps: [
              KFormStep(
                title: 'Amount',
                validate: () => ctrl.text.isEmpty ? 'Enter the amount.' : null,
                builder: (_) => KTextField(label: 'Amount', controller: ctrl),
              ),
              KFormStep(title: 'Proof', builder: (_) => const Text('proof')),
            ],
            review: (_, goTo) => KDetails(items: [KDetail('Amount', ctrl.text)]),
          ),
        ),
      ),
    );
    await t.tap(find.text('Continue'));
    await t.pumpAndSettle();
    expect(find.text('Enter the amount.'), findsOneWidget);
    await t.enterText(find.byType(TextField), '500');
    await t.tap(find.text('Continue'));
    await t.pumpAndSettle();
    await t.tap(find.text('Back'));
    await t.pumpAndSettle();
    expect(find.text('500'), findsOneWidget);
    await t.tap(find.text('Continue'));
    await t.pumpAndSettle();
    await t.tap(find.text('Review'));
    await t.pumpAndSettle();
    expect(find.text('500'), findsOneWidget);
    await t.tap(find.text('Send'));
    await t.pumpAndSettle();
    expect(sent, isTrue);
  });

  testWidgets('showKConfirm: the button repeats the verb and the scrim cancels', (t) async {
    bool? result = true;
    await t.pumpWidget(
      host(
        Builder(
          builder: (c) => KButton(
            'Go',
            onPressed: () async {
              result = await showKConfirm(
                c,
                title: 'Cancel order?',
                message: 'A refund starts.',
                confirmLabel: 'Cancel order',
                cancelLabel: 'Keep order',
                destructive: true,
              );
            },
          ),
        ),
      ),
    );
    await t.tap(find.text('Go'));
    await t.pumpAndSettle();
    expect(find.text('Cancel order'), findsOneWidget);
    await t.tapAt(const Offset(5, 5));
    await t.pumpAndSettle();
    expect(result, isNull);
  });

  testWidgets('everything renders in dark', (t) async {
    await t.pumpWidget(
      host(
        Column(
          children: [
            const KTextField(label: 'Name'),
            KSegmented<int>(segments: const [(0, 'Internal'), (1, 'Customer')], value: 0, onChanged: (_) {}),
            KChip('Open', selected: true, count: 3, onPressed: () {}),
            const KStatTile(label: 'To collect', value: 'USD 19,280'),
            const KProgress(value: 0.6, label: 'Paid'),
            KListItem(title: 'Herat Pharma', subtitle: 'Blister line', onPressed: () {}),
            const KEmptyState(icon: KIcons.file, title: 'No papers', message: 'None yet.'),
          ],
        ),
        dark: true,
      ),
    );
    expect(t.takeException(), isNull);
  });
}
