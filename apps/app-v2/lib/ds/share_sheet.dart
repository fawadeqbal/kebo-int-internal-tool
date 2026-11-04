import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../core/api.dart';
import '../core/files.dart';
import '../core/scope.dart';
import 'theme.dart';
import 'tone.dart';
import 'widgets.dart';

/// Where a paper is sent from the share sheet. Each opens the phone's share sheet with the PDF
/// and the message; Email also gives the subject.
enum ShareTarget {
  whatsapp('WhatsApp', Icons.chat_outlined),
  wechat('WeChat', Icons.forum_outlined),
  email('Email', Icons.mail_outline),
  more('More', Icons.more_horiz);

  const ShareTarget(this.label, this.icon);
  final String label;
  final IconData icon;
}

/// Share a paper with a ready-made message the person can change. [onShared] is told the
/// message and the target once the phone's share sheet reports it was sent.
Future<void> shareWithMessage(
  BuildContext context, {
  required RemoteFile file,
  required String title,
  required String message,
  String? subject,
  String? to,
  void Function(String message, ShareTarget target)? onShared,
}) => showModalBottomSheet<void>(
  context: context,
  isScrollControlled: true,
  useSafeArea: true,
  useRootNavigator: true,
  builder: (_) => _ShareSheet(file: file, title: title, message: message, subject: subject, to: to, onShared: onShared),
);

class _ShareSheet extends StatefulWidget {
  const _ShareSheet({
    required this.file,
    required this.title,
    required this.message,
    this.subject,
    this.to,
    this.onShared,
  });
  final RemoteFile file;
  final String title, message;
  final String? subject, to;
  final void Function(String message, ShareTarget target)? onShared;

  @override
  State<_ShareSheet> createState() => _ShareSheetState();
}

class _ShareSheetState extends State<_ShareSheet> {
  late final ctl = TextEditingController(text: widget.message);
  LoadedFile? loaded;
  String? error;
  ShareTarget? busy;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (loaded == null && error == null) _load();
  }

  @override
  void dispose() {
    ctl.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() => error = null);
    try {
      final f = await context.files.load(widget.file);
      if (mounted) setState(() => loaded = f);
    } on ApiException catch (e) {
      if (mounted) {
        setState(() => error = e.offline ? "No connection, and this PDF isn't kept on the phone yet." : "Couldn't make the PDF. ${e.message}");
      }
    }
  }

  Future<void> _send(ShareTarget t) async {
    final f = loaded;
    if (f == null || busy != null) return;
    setState(() => busy = t);
    final text = ctl.text.trim();
    final ok = await context.files.share(
      f,
      text: text,
      subject: t == ShareTarget.email ? (widget.subject ?? f.name) : null,
    );
    if (!mounted) return;
    setState(() => busy = null);
    if (ok) {
      widget.onShared?.call(text, t);
      Navigator.pop(context);
    }
  }

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final inset = MediaQuery.viewInsetsOf(context).bottom;
    return Padding(
      padding: EdgeInsets.fromLTRB(Gap.lg, 0, Gap.lg, Gap.lg + inset),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Semantics(header: true, child: Text(widget.title, style: context.text.titleLarge)),
                    Text(loaded?.name ?? widget.file.name, style: context.text.bodySmall?.copyWith(color: c.text2)),
                  ],
                ),
              ),
              IconButton(icon: const Icon(Icons.close), tooltip: 'Close', onPressed: () => Navigator.pop(context)),
            ],
          ),
          const SizedBox(height: Gap.md),
          if (error != null) ...[
            MessageBanner(
              error!,
              tone: Tone.bad,
              action: TextButton(onPressed: _load, child: const Text('Try again')),
            ),
            const SizedBox(height: Gap.md),
          ],
          Text('Message', style: context.text.labelMedium),
          const SizedBox(height: 6),
          TextField(
            controller: ctl,
            minLines: 4,
            maxLines: 8,
            maxLength: 2000,
            textCapitalization: TextCapitalization.sentences,
            decoration: const InputDecoration(helperText: 'Ready-made; change anything', semanticCounterText: ''),
          ),
          Align(
            alignment: Alignment.centerLeft,
            child: TextButton.icon(
              onPressed: () async {
                await Clipboard.setData(ClipboardData(text: ctl.text));
                if (context.mounted) toast(context, 'Message copied');
              },
              icon: const Icon(Icons.copy, size: 16),
              label: const Text('Copy the message'),
            ),
          ),
          const SizedBox(height: Gap.sm),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceAround,
            children: [
              for (final t in ShareTarget.values)
                Semantics(
                  button: true,
                  label: 'Share on ${t.label}${widget.to == null ? '' : ' to ${widget.to}'}',
                  excludeSemantics: true,
                  onTap: loaded == null ? null : () => _send(t),
                  child: InkWell(
                    borderRadius: BorderRadius.circular(Gap.radius),
                    onTap: loaded == null ? null : () => _send(t),
                    child: Padding(
                      padding: const EdgeInsets.all(Gap.xs),
                      child: Column(
                        children: [
                          Container(
                            width: 56,
                            height: 56,
                            decoration: BoxDecoration(
                              color: loaded == null ? c.surface2 : c.primarySoft,
                              borderRadius: BorderRadius.circular(16),
                            ),
                            child: busy == t
                                ? const Padding(
                                    padding: EdgeInsets.all(18),
                                    child: CircularProgressIndicator(strokeWidth: 2),
                                  )
                                : Icon(t.icon, color: loaded == null ? c.muted : c.primary),
                          ),
                          const SizedBox(height: 4),
                          Text(t.label, style: context.text.labelSmall),
                        ],
                      ),
                    ),
                  ),
                ),
            ],
          ),
          const SizedBox(height: Gap.sm),
          Text(
            loaded == null && error == null
                ? 'Getting the PDF ready…'
                : 'Choose the app in the phone\'s share sheet. It is noted in the order\'s changes.',
            style: context.text.bodySmall?.copyWith(color: c.muted),
            textAlign: TextAlign.center,
          ),
        ],
      ),
    );
  }
}
