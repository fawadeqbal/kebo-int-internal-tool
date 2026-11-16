import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:rfq_desk/app/app.dart';
import 'package:rfq_desk/core/providers.dart';
import 'package:rfq_desk/core/session.dart';
import 'package:rfq_desk/design/design.dart';

import '../../support/fake_server.dart';

const _me = {
  'id': 'u1',
  'name': 'Fawad Iqbal',
  'email': 'fawad@example.com',
  'roleName': 'Owner',
  'permissions': <String>['*'],
  'company': {'name': 'Kebo International'},
};

Future<Session> _open(WidgetTester t, Map<String, Object?> answers) async {
  KHaptics.enabled = false;
  t.view.physicalSize = const Size(390 * 3, 844 * 3);
  t.view.devicePixelRatio = 3;
  addTearDown(t.view.reset);
  final (s, _) = signedOutSession(answers);
  addTearDown(s.api.net.stop);
  await t.pumpWidget(ProviderScope(overrides: [sessionProvider.overrideWith((ref) => s)], child: const RfqDeskApp()));
  await t.pumpAndSettle();
  return s;
}

Future<void> _type(WidgetTester t, String label, String text) =>
    t.enterText(find.widgetWithText(KTextField, label).first, text);

void main() {
  testWidgets('signed out, the app opens on sign-in; empty fields say what is missing', (t) async {
    await _open(t, {});
    expect(find.text('Welcome to RFQ Desk'), findsOneWidget);
    await t.tap(find.text('Sign in'));
    await t.pumpAndSettle();
    expect(find.text('Enter your work email.'), findsOneWidget);
    expect(find.text('Enter your password.'), findsOneWidget);
  });

  testWidgets('a wrong password shows the server\'s words', (t) async {
    await _open(t, {
      '/api/auth/login': const FakeError(401, {'error': 'That email and password don\'t match.'}),
    });
    await _type(t, 'Work email', 'fawad@example.com');
    await _type(t, 'Password', 'nope');
    await t.tap(find.text('Sign in'));
    await t.pumpAndSettle();
    expect(find.text('That email and password don\'t match.'), findsOneWidget);
  });

  testWidgets('more than one company: choose, then home', (t) async {
    final s = await _open(t, {
      '/api/auth/login': (RequestOptions o) => (o.data as Map)['company'] == null
          ? const FakeError(409, {
              'error': 'Choose a company',
              'code': 'choose_company',
              'companies': [
                {'slug': 'kebo', 'name': 'Kebo International'},
                {'slug': 'kebo-af', 'name': 'Kebo Afghanistan'},
              ],
            })
          : {'token': 't1'},
      '/api/auth/me': _me,
    });
    await _type(t, 'Work email', 'fawad@example.com');
    await _type(t, 'Password', 'secret');
    await t.tap(find.text('Sign in'));
    await t.pumpAndSettle();
    expect(find.text('Which company?'), findsOneWidget);
    await t.tap(find.text('Kebo Afghanistan'));
    await t.pumpAndSettle();
    expect(s.status, SessionStatus.signedIn);
    expect(find.text('fawad@example.com'), findsOneWidget);
  });

  testWidgets('two-step code, then home; sign out goes back to sign-in', (t) async {
    final s = await _open(t, {
      '/api/auth/login': {'token': 't1', 'twoStepRequired': true},
      '/api/auth/two-step': {'ok': true},
      '/api/auth/me': _me,
      '/api/auth/logout': {'ok': true},
    });
    await _type(t, 'Work email', 'fawad@example.com');
    await _type(t, 'Password', 'secret');
    await t.tap(find.text('Sign in'));
    await t.pumpAndSettle();
    expect(find.text('One more step'), findsOneWidget);
    await _type(t, 'Code', '123456');
    await t.tap(find.text('Continue'));
    await t.pumpAndSettle();
    expect(s.status, SessionStatus.signedIn);
    expect(find.text('Kebo International'), findsWidgets);
    await t.scrollUntilVisible(find.text('Sign out'), 300, scrollable: find.byType(Scrollable).first);
    await t.tap(find.text('Sign out'));
    await t.pumpAndSettle();
    expect(s.status, SessionStatus.signedOut);
    expect(find.text('Welcome to RFQ Desk'), findsOneWidget);
  });
}
