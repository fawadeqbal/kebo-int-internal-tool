import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/api.dart';
import '../../core/format.dart' as f;
import '../../core/json.dart';
import '../../core/session.dart';
import '../../theme/colors.dart';
import '../../ui/kit.dart';
import '../auth/auth_screens.dart';

/// My account: profile, two-step sign-in, password.
class AccountScreen extends ConsumerStatefulWidget {
  const AccountScreen({super.key});
  @override
  ConsumerState<AccountScreen> createState() => _AccountScreenState();
}

class _AccountScreenState extends ConsumerState<AccountScreen> {
  final _current = TextEditingController();
  final _new = TextEditingController();
  final _confirm = TextEditingController();
  ApiException? _error;
  bool _changing = false;

  @override
  void initState() {
    super.initState();
    Future.microtask(() => ref.read(sessionProvider.notifier).refreshMe());
  }

  @override
  Widget build(BuildContext context) {
    final s = ref.watch(sessionProvider);
    final twoStep = s.me?.m('twoStep') ?? {};
    final e = _error;
    return Scaffold(
      appBar: AppBar(title: const Text('My account')),
      body: ListView(padding: pagePadding, children: [
        SectionCard(
          title: 'Profile',
          subtitle: 'Ask an administrator to change your name, email or role.',
          child: kv([('Name', s.user.s('name')), ('Email', s.user.s('email')), ('Role', s.user.s('roleLabel'))]),
        ),
        SectionCard(
          title: 'Two-step sign-in',
          subtitle: twoStep.b('on')
              ? 'On since ${f.date(twoStep.s('since'))} · ${twoStep.i('recoveryLeft')} recovery code${twoStep.i('recoveryLeft') == 1 ? '' : 's'} left'
              : "Off. Add a code from your phone to your password, so a stolen password alone can't open your account.",
          child: twoStep.b('on')
              ? Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                  OutlinedButton(onPressed: () => _withCode(context, 'Make new recovery codes', 'Your old recovery codes stop working.', (code) async {
                        final res = await ref.read(apiProvider).post('/api/v1/me/two-step/recovery-codes', {'code': code});
                        await ref.read(sessionProvider.notifier).refreshMe();
                        if (context.mounted) {
                          await showSheet<void>(context, title: 'New recovery codes', builder: (_) => RecoveryCodes(codes: res.ls('recoveryCodes')));
                        }
                      }), child: const Text('Make new recovery codes')),
                  gap8,
                  OutlinedButton(onPressed: () => _withCode(context, 'Move to a new phone', 'Removes the old phone, then shows a new key to add to the new phone.', (code) async {
                        await ref.read(apiProvider).post('/api/v1/me/two-step/off', {'code': code, 'mode': 'new_phone'});
                        await ref.read(sessionProvider.notifier).refreshMe().catchError((_) {});
                        if (context.mounted && ref.read(sessionProvider).status == SessionStatus.signedIn) context.push('/account/two-step');
                      }), child: const Text('Move to a new phone')),
                  if (!twoStep.b('required')) ...[
                    gap8,
                    TextButton(
                      onPressed: () => _withCode(context, 'Turn off two-step sign-in', 'Your account will be protected by the password only.', (code) async {
                        await ref.read(apiProvider).post('/api/v1/me/two-step/off', {'code': code, 'mode': 'off'});
                        await ref.read(sessionProvider.notifier).refreshMe();
                        if (context.mounted) toast(context, 'Two-step sign-in turned off');
                      }),
                      child: Text('Turn off', style: TextStyle(color: context.c.bad)),
                    ),
                  ],
                ])
              : FilledButton(onPressed: () => context.push('/account/two-step'), child: const Text('Set up two-step sign-in')),
        ),
        SectionCard(
          title: 'Password',
          subtitle: 'Changing it signs out your other devices; this one stays signed in.',
          child: !_changing
              ? Align(alignment: Alignment.centerLeft, child: OutlinedButton(onPressed: () => setState(() => _changing = true), child: const Text('Change my password')))
              : Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            if (e != null && e.fieldErrors.isEmpty) Notice(e.message, tone: Tone.bad),
            Field(label: 'Current password', controller: _current, obscure: true, autofill: const [AutofillHints.password], error: e?.field('currentPassword')),
            Field(label: 'New password', controller: _new, obscure: true, autofill: const [AutofillHints.newPassword], helper: 'At least 8 characters, with a letter and a number', error: e?.field('password')),
            Field(label: 'Confirm new password', controller: _confirm, obscure: true, error: e?.field('confirm')),
            BusyButton(
              label: 'Change password',
              style: BusyStyle.outlined,
              onPressed: () async {
                setState(() => _error = null);
                try {
                  final res = await ref.read(apiProvider).post('/api/v1/me/password', {'currentPassword': _current.text, 'password': _new.text, 'confirm': _confirm.text});
                  for (final c in [_current, _new, _confirm]) {
                    c.clear();
                  }
                  setState(() => _changing = false);
                  if (context.mounted) toast(context, res.s('message', 'Password changed'));
                } on ApiException catch (err) {
                  setState(() => _error = err);
                }
              },
            ),
            TextButton(
              onPressed: () => setState(() {
                for (final c in [_current, _new, _confirm]) {
                  c.clear();
                }
                _error = null;
                _changing = false;
              }),
              child: const Text('Cancel'),
            ),
          ]),
        ),
      ]),
    );
  }

  Future<void> _withCode(BuildContext context, String title, String message, Future<void> Function(String code) run) async {
    final code = TextEditingController();
    String? error;
    await showSheet<void>(
      context,
      title: title,
      subtitle: '$message Enter a current code from your authenticator app.',
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, set) => Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          if (error != null) Notice(error!, tone: Tone.bad),
          Field(label: 'Code from your app', controller: code, keyboard: TextInputType.number, mono: true, autofocus: true, autofill: const [AutofillHints.oneTimeCode]),
          BusyButton(
            label: title,
            onPressed: () async {
              try {
                await run(code.text.trim());
                if (ctx.mounted) Navigator.pop(ctx);
              } on ApiException catch (e) {
                set(() => error = e.message);
              }
            },
          ),
        ]),
      ),
    );
  }
}
