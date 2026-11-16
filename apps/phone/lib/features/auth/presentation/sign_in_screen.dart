import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/api.dart';
import '../../../core/json.dart';
import '../../../core/providers.dart';
import '../../../core/session.dart';
import '../../../design/design.dart';

/// Email and password; then the company, when the email is in more than one; then the
/// two-step code, when it is on. The server can be changed at the bottom.
class SignInScreen extends ConsumerStatefulWidget {
  const SignInScreen({super.key});

  @override
  ConsumerState<SignInScreen> createState() => _SignInScreenState();
}

class _SignInScreenState extends ConsumerState<SignInScreen> {
  final _email = TextEditingController();
  final _password = TextEditingController();
  final _code = TextEditingController();
  bool _busy = false;
  bool _show = false;
  String? _problem;
  Map<String, String> _fields = const {};

  @override
  void dispose() {
    _email.dispose();
    _password.dispose();
    _code.dispose();
    super.dispose();
  }

  Future<void> _go(Future<void> Function() step) async {
    FocusScope.of(context).unfocus();
    setState(() {
      _busy = true;
      _problem = null;
      _fields = const {};
    });
    try {
      await step();
    } on ApiException catch (e) {
      if (!mounted) return;
      if (e.code != 'choose_company') {
        KHaptics.error();
        setState(() {
          _problem = e.fieldErrors.isEmpty ? e.message : null;
          _fields = e.fieldErrors;
        });
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  void _signIn(Session s, {String? company}) {
    if (_email.text.trim().isEmpty || _password.text.isEmpty) {
      KHaptics.error();
      setState(
        () => _fields = {
          if (_email.text.trim().isEmpty) 'email': 'Enter your work email.',
          if (_password.text.isEmpty) 'password': 'Enter your password.',
        },
      );
      return;
    }
    _go(() => s.signIn(_email.text, _password.text, company: company));
  }

  Future<void> _changeServer(Session s) async {
    final ctl = TextEditingController(text: s.api.server);
    await showKSheet<void>(
      context,
      title: 'Server',
      builder: (_) => KTextField(
        label: 'Server address',
        controller: ctl,
        keyboardType: TextInputType.url,
        hint: 'https://rfq.example.com',
        help: 'Only change this if your company runs its own RFQ Desk server.',
      ),
      footer: KButton(
        'Use this server',
        fullWidth: true,
        onPressed: () async {
          if (ctl.text.trim().isNotEmpty) await s.setServer(ctl.text);
          if (mounted) Navigator.of(context).pop();
        },
      ),
    );
    ctl.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final s = ref.watch(sessionProvider);
    final c = context.k;
    final needsCode = s.status == SessionStatus.needsCode;
    return Scaffold(
      backgroundColor: c.bg,
      body: Column(
        children: [
          // The brand band: who this app belongs to, before anything is asked.
          Container(
            width: double.infinity,
            color: c.brandSurface,
            child: SafeArea(
              bottom: false,
              child: Padding(
                padding: const EdgeInsets.fromLTRB(KSpace.s6, KSpace.s8, KSpace.s6, KSpace.s6),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    ExcludeSemantics(
                      child: Container(
                        width: 48,
                        height: 48,
                        alignment: Alignment.center,
                        decoration: BoxDecoration(
                          color: c.onBrandSurface.withValues(alpha: 0.14),
                          borderRadius: BorderRadius.circular(KRadius.md),
                        ),
                        child: Text(
                          'RQ',
                          style: KType.title3.copyWith(color: c.onBrandSurface, fontWeight: FontWeight.w800),
                        ),
                      ),
                    ),
                    const SizedBox(height: KSpace.s5),
                    Semantics(
                      header: true,
                      child: Text(
                        needsCode ? 'One more step' : 'Welcome to RFQ Desk',
                        style: KType.title1.copyWith(color: c.onBrandSurface),
                      ),
                    ),
                    const SizedBox(height: KSpace.s1),
                    Text(
                      needsCode
                          ? 'Your account has two-step sign-in on.'
                          : 'Inquiries, orders and money, in your pocket.',
                      style: KType.callout.copyWith(color: c.onBrandSurfaceMuted),
                    ),
                  ],
                ),
              ),
            ),
          ),
          Expanded(
            child: Center(
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 440),
                child: ListView(
                  padding: const EdgeInsets.all(KSpace.s6),
                  children: [
                    if (s.notice != null) ...[
                      KBanner(s.notice!, tone: KTone.warning),
                      const SizedBox(height: KSpace.s4),
                    ],
                    if (_problem != null) ...[
                      KBanner(_problem!, tone: KTone.danger),
                      const SizedBox(height: KSpace.s4),
                    ],
                    if (needsCode) ..._codeStep(s) else ..._passwordStep(s),
                    const SizedBox(height: KSpace.s8),
                    Row(
                      children: [
                        KIcon(KIcons.globe, size: 16, color: c.inkMuted),
                        const SizedBox(width: KSpace.s2),
                        Expanded(
                          child: Text(
                            s.api.server.replaceFirst(RegExp(r'^https?://'), ''),
                            style: KType.footnote.copyWith(color: c.inkMuted),
                            overflow: TextOverflow.ellipsis,
                          ),
                        ),
                        KButton(
                          'Change server',
                          variant: KButtonVariant.tertiary,
                          onPressed: _busy ? null : () => _changeServer(s),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }

  List<Widget> _passwordStep(Session s) => [
    AutofillGroup(
      child: Column(
        children: [
          KTextField(
            label: 'Work email',
            controller: _email,
            keyboardType: TextInputType.emailAddress,
            textInputAction: TextInputAction.next,
            autofillHints: const [AutofillHints.email, AutofillHints.username],
            error: _fields['email'],
            enabled: !_busy,
          ),
          const SizedBox(height: KSpace.s4),
          KTextField(
            label: 'Password',
            controller: _password,
            obscure: !_show,
            textInputAction: TextInputAction.go,
            autofillHints: const [AutofillHints.password],
            trailingIcon: KIcons.lock,
            trailingLabel: _show ? 'Hide password' : 'Show password',
            onTrailingPressed: () => setState(() => _show = !_show),
            onSubmitted: (_) => _signIn(s),
            error: _fields['password'],
            enabled: !_busy,
          ),
        ],
      ),
    ),
    const SizedBox(height: KSpace.s6),
    KButton(
      _busy ? 'Signing in' : 'Sign in',
      size: KButtonSize.lg,
      fullWidth: true,
      loading: _busy,
      onPressed: () => _signIn(s),
    ),
    if (s.companies.isNotEmpty) ...[
      const SizedBox(height: KSpace.s6),
      KSection(
        title: 'Which company?',
        caption: 'This email works in more than one.',
        children: [
          KCard(
            padding: EdgeInsets.zero,
            child: Column(
              children: [
                for (final (i, co) in s.companies.indexed)
                  KListItem(
                    leading: KAvatar(co.str('name')),
                    title: co.str('name'),
                    subtitle: co.str('slug'),
                    divider: i < s.companies.length - 1,
                    onPressed: _busy ? null : () => _signIn(s, company: co.str('slug')),
                  ),
              ],
            ),
          ),
        ],
      ),
    ],
  ];

  List<Widget> _codeStep(Session s) => [
    Text(
      'Enter the 6-digit code from your authenticator app, or one of your recovery codes.',
      style: KType.body.copyWith(color: context.k.inkMuted),
    ),
    const SizedBox(height: KSpace.s4),
    KTextField(
      label: 'Code',
      controller: _code,
      keyboardType: TextInputType.visiblePassword,
      autofillHints: const [AutofillHints.oneTimeCode],
      inputFormatters: [FilteringTextInputFormatter.deny(RegExp(r'\s'))],
      textInputAction: TextInputAction.go,
      onSubmitted: (_) => _go(() => s.verifyCode(_code.text)),
      error: _fields['code'],
      enabled: !_busy,
    ),
    const SizedBox(height: KSpace.s6),
    KButton(
      'Continue',
      size: KButtonSize.lg,
      fullWidth: true,
      loading: _busy,
      onPressed: () => _go(() => s.verifyCode(_code.text)),
    ),
    const SizedBox(height: KSpace.s2),
    KButton(
      'Use another account',
      variant: KButtonVariant.tertiary,
      fullWidth: true,
      onPressed: _busy ? null : s.signOut,
    ),
  ];
}
