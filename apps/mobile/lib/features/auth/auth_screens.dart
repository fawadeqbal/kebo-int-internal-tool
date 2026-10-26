import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:qr_flutter/qr_flutter.dart';
import 'package:share_plus/share_plus.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../core/api.dart';
import '../../core/json.dart';
import '../../core/session.dart';
import '../../theme/colors.dart';
import '../../ui/kit.dart';

/// The centred card with the company mark, used by all sign-in screens.
class AuthFrame extends ConsumerWidget {
  const AuthFrame({super.key, required this.children});
  final List<Widget> children;
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Scaffold(
      body: Stack(
        children: [
          Positioned(
            top: -220,
            left: -60,
            right: -60,
            child: Container(height: 360, decoration: BoxDecoration(shape: BoxShape.circle, color: context.c.primary.withValues(alpha: 0.10))),
          ),
          SafeArea(
            child: Center(
              child: SingleChildScrollView(
                padding: const EdgeInsets.all(20),
                child: ConstrainedBox(
                  constraints: const BoxConstraints(maxWidth: 420),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      const _Brand(),
                      gap24,
                      Card(child: Padding(padding: const EdgeInsets.all(20), child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: children))),
                      gap16,
                      Text('Deals, quotations and orders, from the first message to shipment.', textAlign: TextAlign.center, style: context.t.bodySmall),
                    ],
                  ),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _Brand extends StatelessWidget {
  const _Brand();
  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        const BrandMark(size: 42),
        gap12,
        Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text('Kebo RFQ Desk', style: context.t.titleMedium),
          Text('Shandong Kebo International Trade · staff only', style: context.t.bodySmall),
        ]),
      ],
    );
  }
}

/// The KEBO logo (as on keboint.com and the app icon).
class BrandMark extends StatelessWidget {
  const BrandMark({super.key, this.size = 36});
  final double size;
  @override
  Widget build(BuildContext context) {
    return Image.asset('assets/brand/kebo-logo.png', width: size, height: size, filterQuality: FilterQuality.medium, semanticLabel: 'KEBO International');
  }
}

/* ---------------------------------------------------------------- Sign in */

class LoginScreen extends ConsumerStatefulWidget {
  const LoginScreen({super.key});
  @override
  ConsumerState<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends ConsumerState<LoginScreen> {
  final _email = TextEditingController();
  final _password = TextEditingController();
  ApiException? _error;
  bool _show = false;

  @override
  void dispose() {
    _email.dispose();
    _password.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    setState(() => _error = null);
    try {
      await ref.read(sessionProvider.notifier).signIn(_email.text, _password.text);
    } on ApiException catch (e) {
      setState(() => _error = e);
    }
  }

  @override
  Widget build(BuildContext context) {
    final session = ref.watch(sessionProvider);
    final server = ref.read(apiProvider).baseUrl;
    return AuthFrame(children: [
      Text('Sign in', style: context.t.titleLarge),
      gap4,
      Text('Use the account your admin set up for you.', style: context.t.bodySmall),
      gap16,
      if (session.message != null && _error == null) Notice(session.message!, tone: Tone.info),
      if (_error != null && _error!.fieldErrors.isEmpty) Notice(_error!.message, tone: Tone.bad),
      AutofillGroup(
        child: Column(children: [
          Field(label: 'Email', controller: _email, keyboard: TextInputType.emailAddress, autofill: const [AutofillHints.username, AutofillHints.email], error: _error?.field('email'), textInputAction: TextInputAction.next),
          Field(
            label: 'Password',
            controller: _password,
            obscure: !_show,
            autofill: const [AutofillHints.password],
            error: _error?.field('password'),
            textInputAction: TextInputAction.done,
            onSubmitted: (_) => _submit(),
            suffix: IconButton(icon: Icon(_show ? Icons.visibility_off_outlined : Icons.visibility_outlined, size: 20), onPressed: () => setState(() => _show = !_show)),
          ),
        ]),
      ),
      gap4,
      BusyButton(label: 'Sign in', onPressed: _submit),
      gap12,
      Center(
        child: TextButton.icon(
          onPressed: () => _editServer(context, server),
          icon: Icon(Icons.dns_outlined, size: 16, color: context.c.muted),
          label: Text(Uri.tryParse(server)?.host ?? server, style: context.t.bodySmall),
        ),
      ),
    ]);
  }

  Future<void> _editServer(BuildContext context, String current) async {
    final ctrl = TextEditingController(text: current);
    final result = await showSheet<String>(
      context,
      title: 'Server',
      subtitle: 'The address of your Kebo RFQ Desk. Only change this if your admin asks you to.',
      builder: (ctx) => Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Field(label: 'Address', controller: ctrl, keyboard: TextInputType.url, hint: defaultServer),
        FilledButton(onPressed: () => Navigator.pop(ctx, ctrl.text), child: const Text('Save')),
        TextButton(onPressed: () => Navigator.pop(ctx, defaultServer), child: const Text('Use the default')),
      ]),
    );
    if (result != null && result.trim().isNotEmpty) {
      await ref.read(sessionProvider.notifier).setServer(result.startsWith('http') ? result : 'https://$result');
      setState(() {});
    }
  }
}

/* ---------------------------------------------------------------- Code */

class CodeScreen extends ConsumerStatefulWidget {
  const CodeScreen({super.key});
  @override
  ConsumerState<CodeScreen> createState() => _CodeScreenState();
}

class _CodeScreenState extends ConsumerState<CodeScreen> {
  final _code = TextEditingController();
  String? _error;

  Future<void> _submit() async {
    setState(() => _error = null);
    try {
      final res = await ref.read(sessionProvider.notifier).verifyCode(_code.text);
      if (res.b('usedRecoveryCode') && mounted) {
        toast(context, 'Signed in with a recovery code. ${res.i('recoveryCodesLeft')} left — make new ones in Account if you are running low.');
      }
    } on ApiException catch (e) {
      setState(() => _error = e.message);
    }
  }

  @override
  Widget build(BuildContext context) {
    return AuthFrame(children: [
      Text('Two-step sign-in', style: context.t.titleLarge),
      gap4,
      Text('Open your authenticator app and enter the 6-digit code for Kebo RFQ Desk.', style: context.t.bodySmall),
      gap16,
      if (_error != null) Notice(_error!, tone: Tone.bad),
      Field(
        label: 'Code from your app',
        controller: _code,
        autofocus: true,
        keyboard: TextInputType.visiblePassword,
        autofill: const [AutofillHints.oneTimeCode],
        mono: true,
        hint: '123456 or abcd-efgh',
        helper: 'Lost your phone? Enter one of your recovery codes instead.',
        onSubmitted: (_) => _submit(),
      ),
      BusyButton(label: 'Verify and sign in', onPressed: _submit),
      gap8,
      TextButton(onPressed: () => ref.read(sessionProvider.notifier).backToSignIn(), child: const Text('Back to sign in')),
    ]);
  }
}

/* ---------------------------------------------------------------- Setup */

/// POST /api/me/two-step/setup: a new secret and its otpauth:// link (until confirmed).
final _setupProvider = FutureProvider.autoDispose<Json>((ref) => ref.read(repoProvider).twoStepSetup());

/// Two-step setup, opened from My account.
class TwoStepSetupScreen extends ConsumerStatefulWidget {
  const TwoStepSetupScreen({super.key, this.fromAccount = true});
  final bool fromAccount;
  @override
  ConsumerState<TwoStepSetupScreen> createState() => _TwoStepSetupScreenState();
}

class _TwoStepSetupScreenState extends ConsumerState<TwoStepSetupScreen> {
  final _code = TextEditingController();
  String? _error;
  List<String>? _codes;

  Future<void> _confirm() async {
    setState(() => _error = null);
    try {
      final res = await ref.read(repoProvider).twoStepConfirm(_code.text);
      setState(() => _codes = res.ls('recoveryCodes'));
    } on ApiException catch (e) {
      setState(() => _error = e.message);
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_codes != null) {
      return AuthFrame(children: [
        Text('Two-step sign-in is on', style: context.t.titleLarge),
        gap16,
        RecoveryCodes(codes: _codes!),
        gap16,
        FilledButton(
          onPressed: () => Navigator.of(context).maybePop(),
          child: const Text("I've saved them — continue"),
        ),
      ]);
    }
    final setup = ref.watch(_setupProvider);
    return AuthFrame(children: [
      Text('Set up two-step sign-in', style: context.t.titleLarge),
      gap4,
      Text("After your password you'll also enter a code from your phone, so a stolen password alone can't open your account.", style: context.t.bodySmall),
      gap16,
      setup.when(
        loading: () => const LoadingView(),
        error: (e, _) => ErrorState(e, onRetry: () => ref.invalidate(_setupProvider)),
        data: (s) {
          final secret = s.s('secret');
          final url = s.s('otpauthUrl');
          return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            _Step(n: 1, title: 'Install an authenticator app', body: 'Google Authenticator, Microsoft Authenticator or any app for “TOTP” codes.'),
            _Step(
              n: 2,
              title: 'Add Kebo RFQ Desk to it',
              body: 'On this phone: tap the button. On another phone: scan the QR code.',
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                gap8,
                OutlinedButton.icon(
                  onPressed: () async {
                    final ok = await launchUrl(Uri.parse(url), mode: LaunchMode.externalApplication).catchError((_) => false);
                    if (!ok && context.mounted) toast(context, 'No authenticator app found. Install one, or enter the key by hand.', error: true);
                  },
                  icon: const Icon(Icons.open_in_new_rounded, size: 18),
                  label: const Text('Open in authenticator app'),
                ),
                gap12,
                Center(
                  child: Container(
                    padding: const EdgeInsets.all(8),
                    decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(12), border: Border.all(color: context.c.line)),
                    child: QrImageView(data: url, size: 168, padding: EdgeInsets.zero),
                  ),
                ),
                gap12,
                Text('Or enter this key:', style: context.t.bodySmall),
                gap4,
                InkWell(
                  onTap: () {
                    Clipboard.setData(ClipboardData(text: secret));
                    toast(context, 'Key copied');
                  },
                  child: Container(
                    padding: const EdgeInsets.all(10),
                    decoration: BoxDecoration(color: context.c.surface2, borderRadius: BorderRadius.circular(8)),
                    child: Row(children: [
                      Expanded(child: SelectableText(RegExp(r'.{1,4}').allMatches(secret).map((m) => m.group(0)).join(' '), style: mono13(context))),
                      Icon(Icons.copy_rounded, size: 16, color: context.c.muted),
                    ]),
                  ),
                ),
              ]),
            ),
            _Step(
              n: 3,
              title: 'Enter the code it shows',
              child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                gap8,
                if (_error != null) Notice(_error!, tone: Tone.bad),
                Field(label: '6-digit code', controller: _code, keyboard: TextInputType.number, mono: true, autofill: const [AutofillHints.oneTimeCode], onSubmitted: (_) => _confirm()),
                BusyButton(label: 'Turn on two-step sign-in', onPressed: _confirm),
              ]),
            ),
          ]);
        },
      ),
      gap8,
      Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
        TextButton(
          onPressed: () => ref.invalidate(_setupProvider),
          child: Text('New key', style: TextStyle(color: context.c.muted)),
        ),
        if (widget.fromAccount)
          TextButton(onPressed: () => Navigator.of(context).maybePop(), child: Text('Cancel', style: TextStyle(color: context.c.muted)))
        else
          TextButton(onPressed: () => ref.read(sessionProvider.notifier).signOut(), child: Text('Sign out', style: TextStyle(color: context.c.muted))),
      ]),
    ]);
  }
}

class _Step extends StatelessWidget {
  const _Step({required this.n, required this.title, this.body, this.child});
  final int n;
  final String title;
  final String? body;
  final Widget? child;
  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 16),
      child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Container(
          width: 24,
          height: 24,
          alignment: Alignment.center,
          decoration: BoxDecoration(color: context.c.primarySoft, shape: BoxShape.circle),
          child: Text('$n', style: TextStyle(fontFamily: 'Geist', fontSize: 12, fontWeight: FontWeight.w700, color: context.c.primary)),
        ),
        gap12,
        Expanded(
          child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            Text(title, style: context.t.titleSmall),
            if (body != null) Padding(padding: const EdgeInsets.only(top: 2), child: Text(body!, style: context.t.bodySmall)),
            ?child,
          ]),
        ),
      ]),
    );
  }
}

/// The 10 one-time recovery codes, shown once, with copy and share.
class RecoveryCodes extends StatelessWidget {
  const RecoveryCodes({super.key, required this.codes});
  final List<String> codes;
  @override
  Widget build(BuildContext context) {
    final text = 'Kebo RFQ Desk recovery codes (each works once)\n\n${codes.join('\n')}\n';
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      const Notice('Save these recovery codes now — they are shown only once. Each one lets you sign in once if you lose your phone.', tone: Tone.warn),
      Container(
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(color: context.c.surface2, borderRadius: BorderRadius.circular(10), border: Border.all(color: context.c.line)),
        child: Wrap(
          spacing: 24,
          runSpacing: 8,
          children: [for (final c in codes) SizedBox(width: 120, child: SelectableText(c, style: mono13(context).copyWith(fontSize: 14)))],
        ),
      ),
      gap12,
      Row(children: [
        Expanded(
          child: OutlinedButton.icon(
            onPressed: () {
              Clipboard.setData(ClipboardData(text: text));
              toast(context, 'Recovery codes copied');
            },
            icon: const Icon(Icons.copy_rounded, size: 18),
            label: const Text('Copy'),
          ),
        ),
        gap8,
        Expanded(
          child: OutlinedButton.icon(
            onPressed: () => SharePlus.instance.share(ShareParams(text: text, subject: 'Kebo RFQ Desk recovery codes')),
            icon: const Icon(Icons.ios_share_rounded, size: 18),
            label: const Text('Save / share'),
          ),
        ),
      ]),
    ]);
  }
}
