import 'package:flutter/material.dart';

import '../core/api.dart';
import '../core/json.dart';
import '../core/scope.dart';
import '../core/session.dart';
import '../ds/ds.dart';
import '../generated/routes.g.dart';

/// Email and password, then the company (when the email is in more than one),
/// then the two-step code (when it is on).
class SignInScreen extends StatefulWidget {
  const SignInScreen({super.key});

  @override
  State<SignInScreen> createState() => _SignInScreenState();
}

class _SignInScreenState extends State<SignInScreen> {
  final email = TextEditingController();
  final password = TextEditingController();
  final code = TextEditingController();
  String? problem;
  bool busy = false;

  @override
  void dispose() {
    email.dispose();
    password.dispose();
    code.dispose();
    super.dispose();
  }

  Future<void> _go(Future<void> Function() step) async {
    setState(() {
      busy = true;
      problem = null;
    });
    try {
      await step();
    } on ApiException catch (e) {
      if (mounted && e.code != 'choose_company') setState(() => problem = e.message);
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  Future<void> _server(Session s) async {
    final ctl = TextEditingController(text: s.api.server);
    final v = await showDialog<String>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Server'),
        content: TextField(
          controller: ctl,
          keyboardType: TextInputType.url,
          autocorrect: false,
          decoration: const InputDecoration(hintText: 'https://rfq.example.com'),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.pop(ctx, ctl.text), child: const Text('Use this server')),
        ],
      ),
    );
    ctl.dispose();
    if (v != null && v.trim().isNotEmpty) await s.setServer(v);
  }

  @override
  Widget build(BuildContext context) {
    final s = context.session;
    final c = context.colors;
    final needsCode = s.status == SessionStatus.needsCode;
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 420),
            child: ListView(
              padding: const EdgeInsets.all(Gap.xl),
              shrinkWrap: true,
              children: [
                ExcludeSemantics(
                  child: Align(
                    alignment: Alignment.centerLeft,
                    child: Container(
                      width: 56,
                      height: 56,
                      alignment: Alignment.center,
                      decoration: BoxDecoration(color: c.primarySolid, borderRadius: BorderRadius.circular(14)),
                      child: Text('RQ', style: context.text.titleMedium?.copyWith(color: c.primaryFg, fontWeight: FontWeight.w800)),
                    ),
                  ),
                ),
                const SizedBox(height: Gap.lg),
                Semantics(header: true, child: Text(needsCode ? 'Two-step code' : 'Sign in to $appName', style: context.text.titleLarge)),
                const SizedBox(height: Gap.lg),
                if (s.notice != null) ...[MessageBanner(s.notice!), const SizedBox(height: Gap.md)],
                if (problem != null) ...[MessageBanner(problem!, tone: Tone.bad), const SizedBox(height: Gap.md)],
                if (needsCode) ...[
                  Text('Enter the 6-digit code from your authenticator app, or a recovery code.',
                      style: context.text.bodyMedium?.copyWith(color: c.text2)),
                  const SizedBox(height: Gap.md),
                  _labelled('Code', TextField(
                    controller: code,
                    keyboardType: TextInputType.number,
                    autofillHints: const [AutofillHints.oneTimeCode],
                    onSubmitted: (_) => _go(() => s.verifyCode(code.text)),
                  )),
                  const SizedBox(height: Gap.lg),
                  FilledButton(onPressed: busy ? null : () => _go(() => s.verifyCode(code.text)), child: const Text('Continue')),
                ] else ...[
                  AutofillGroup(
                    child: Column(children: [
                      _labelled('Email', TextField(
                        controller: email,
                        keyboardType: TextInputType.emailAddress,
                        autocorrect: false,
                        autofillHints: const [AutofillHints.email],
                        textInputAction: TextInputAction.next,
                      )),
                      const SizedBox(height: Gap.md),
                      _labelled('Password', TextField(
                        controller: password,
                        obscureText: true,
                        autofillHints: const [AutofillHints.password],
                        onSubmitted: (_) => _go(() => s.signIn(email.text, password.text)),
                      )),
                    ]),
                  ),
                  const SizedBox(height: Gap.lg),
                  FilledButton(
                    onPressed: busy ? null : () => _go(() => s.signIn(email.text, password.text)),
                    child: Text(busy ? 'Signing in…' : 'Sign in'),
                  ),
                  if (s.companies.isNotEmpty) ...[
                    const SizedBox(height: Gap.lg),
                    SectionCard(
                      title: 'Which company?',
                      child: Column(children: [
                        for (final (i, co) in s.companies.indexed)
                          PhoneRow(
                            RowData(
                              title: co.str('name'),
                              sub: [co.str('slug')],
                              onTap: () => _go(() => s.signIn(email.text, password.text, company: co.str('slug'))),
                            ),
                            divider: i < s.companies.length - 1,
                          ),
                      ]),
                    ),
                  ],
                ],
                const SizedBox(height: Gap.xl),
                Row(children: [
                  Expanded(
                    child: Text('Server: ${s.api.server.replaceFirst(RegExp(r'^https?://'), '')}',
                        style: context.text.bodySmall?.copyWith(color: c.muted)),
                  ),
                  TextButton(onPressed: () => _server(s), child: const Text('Change')),
                ]),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _labelled(String label, Widget field) => Semantics(
        label: label,
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          ExcludeSemantics(child: Text(label, style: context.text.labelMedium)),
          const SizedBox(height: 6),
          field,
        ]),
      );
}
