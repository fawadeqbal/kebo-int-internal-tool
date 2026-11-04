import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../core/api.dart';
import '../core/files.dart';
import '../core/outbox.dart';
import '../core/scope.dart';
import '../core/session.dart';
import '../core/share_in.dart';
import '../ds/ds.dart';
import '../generated/screens/inquiries.g.dart';
import '../generated/screens/inquiry_form.g.dart';

/// /inquiries/new: Share → RFQ Desk (the [inbox]) or rfqdesk://inquiries/new?text=… ([text]).
/// The inquiries list with the new inquiry form over it: the words go in "Their message", the
/// files are listed and sent to the inquiry once it is saved. Then the new inquiry opens.
class NewInquiryScreen extends StatefulWidget {
  const NewInquiryScreen({super.key, this.inbox, this.text});
  final ShareInbox? inbox;
  final String? text;

  @override
  State<NewInquiryScreen> createState() => _NewInquiryScreenState();
}

class _NewInquiryScreenState extends State<NewInquiryScreen> {
  bool _opened = false;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    // Only once signed in: while the app starts, the person may still have to sign in first.
    if (_opened || context.session.status != SessionStatus.signedIn) return;
    _opened = true;
    WidgetsBinding.instance.addPostFrameCallback((_) => _open());
  }

  Future<void> _open() async {
    if (!mounted) return;
    final shared = widget.inbox?.take();
    final text = [shared?.text, widget.text].whereType<String>().map((t) => t.trim()).where((t) => t.isNotEmpty).join('\n\n');
    final made = await openNewInquiry(context, text: text, files: shared?.files ?? const [], refused: shared?.refused ?? const []);
    if (!mounted) return;
    if (made == null) return context.go('/inquiries');
    toast(context, made.message);
    context.go('/inquiries/${made.id}');
  }

  @override
  Widget build(BuildContext context) => const InquiriesScreen();
}

/// The inquiry made from a share, and what to tell the person.
class MadeInquiry {
  const MadeInquiry(this.id, this.message);
  final String id, message;
}

/// The new inquiry form with [text] in "Their message" (its first line as the title) and [files]
/// to attach. Null when closed without saving.
Future<MadeInquiry?> openNewInquiry(BuildContext context,
    {String text = '', List<SharedFile> files = const [], List<String> refused = const []}) async {
  final list = SharedFiles(files);
  final outbox = context.outbox;
  MadeInquiry? made;
  final firstLine = text.split('\n').map((l) => l.trim()).firstWhere((l) => l.isNotEmpty, orElse: () => '');
  final saved = await InquiryFormSheet.create(
    context,
    prefill: {
      if (text.isNotEmpty) 'requirements': text.length > 20000 ? text.substring(0, 20000) : text,
      if (firstLine.isNotEmpty) 'title': firstLine.length > 200 ? '${firstLine.substring(0, 199)}…' : firstLine,
    },
    extra: (setState) => _FilesToAttach(list: list, refused: refused),
    then: (_, inquiry) async {
      final sent = await list.send(outbox, inquiry.id, inquiry.refNo ?? 'the new inquiry');
      made = MadeInquiry(inquiry.id, joinParts([inquiry.refNo == null ? 'Inquiry created' : 'Inquiry ${inquiry.refNo} created', sent]));
    },
  );
  return saved ? made : null;
}

/// How a file to attach is doing.
enum SendState { waiting, sending, sent, kept, failed }

/// The files to attach to the new inquiry, with how each is doing once Save is pressed.
class SharedFiles extends ChangeNotifier {
  SharedFiles(List<SharedFile> files) : files = [...files];
  final List<SharedFile> files;
  final Map<SharedFile, SendState> state = {};
  final Map<SharedFile, String> problem = {};

  void add(SharedFile f) {
    files.add(f);
    notifyListeners();
  }

  void remove(SharedFile f) {
    files.remove(f);
    notifyListeners();
  }

  void _set(SharedFile f, SendState s) {
    state[f] = s;
    notifyListeners();
  }

  /// Sends each file to the saved inquiry, one by one. Never throws: the inquiry is saved; a file
  /// that fails is said in the answer (to add again on the inquiry), with no signal it waits.
  Future<String?> send(Outbox outbox, String id, String ref) async {
    var ok = 0, kept = 0, failed = 0;
    for (final f in [...files]) {
      _set(f, SendState.sending);
      try {
        final sent = await (outbox.chain('Add to $ref · ${f.name}')
              ..upload('/api/inquiries/$id/files', f.bytes, f.name, fields: {'kind': f.isImage ? 'photo' : 'other'}))
            .send();
        _set(f, sent.queued ? SendState.kept : SendState.sent);
        sent.queued ? kept++ : ok++;
      } on ApiException catch (e) {
        problem[f] = e.message;
        _set(f, SendState.failed);
        failed++;
      }
    }
    return joinParts([
      if (ok > 0) count(ok, '1 file attached', '{} files attached'),
      if (kept > 0) count(kept, '1 file sends when online', '{} files send when online'),
      if (failed > 0) count(failed, '1 file not attached: add it again', '{} files not attached: add them again'),
    ]);
  }
}

class _FilesToAttach extends StatelessWidget {
  const _FilesToAttach({required this.list, required this.refused});
  final SharedFiles list;
  final List<String> refused;

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    return ListenableBuilder(
      listenable: list,
      builder: (context, _) => Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        SizedBox(
          height: Gap.tap,
          child: Row(children: [
            Expanded(
              child: Semantics(
                header: true,
                child: Text(list.files.isEmpty ? 'Files' : 'Files · ${list.files.length}', style: context.text.titleMedium),
              ),
            ),
          ]),
        ),
        for (final f in list.files) _row(context, f),
        for (final r in refused)
          Padding(
            padding: const EdgeInsets.only(bottom: Gap.sm),
            child: Text('Not attached: $r', style: context.text.bodySmall?.copyWith(color: c.bad)),
          ),
        if (list.files.isNotEmpty)
          Padding(
            padding: const EdgeInsets.only(bottom: Gap.sm),
            child: Text('Sent to the inquiry when it is saved.', style: context.text.bodySmall?.copyWith(color: c.muted)),
          ),
        Align(
          alignment: Alignment.centerLeft,
          child: OutlinedButton.icon(
            icon: const Icon(Icons.attach_file, size: 18),
            label: const Text('Add a file or photo'),
            onPressed: list.state.isNotEmpty
                ? null
                : () async {
                    final p = await pickFile(context);
                    if (p != null) list.add(SharedFile(p.name, p.bytes));
                  },
          ),
        ),
        const SizedBox(height: Gap.lg),
      ]),
    );
  }

  Widget _row(BuildContext context, SharedFile f) {
    final c = context.colors;
    final s = list.state[f] ?? SendState.waiting;
    final status = switch (s) {
      SendState.waiting => fileSize(f.bytes.length),
      SendState.sending => 'Sending…',
      SendState.sent => 'Attached',
      SendState.kept => 'Sends when online',
      SendState.failed => 'Not attached: ${list.problem[f] ?? ''}',
    };
    return Padding(
      padding: const EdgeInsets.only(bottom: Gap.sm),
      child: Row(children: [
        ClipRRect(
          borderRadius: BorderRadius.circular(Gap.radiusSm),
          child: f.isImage
              ? Image.memory(f.bytes, width: 48, height: 48, fit: BoxFit.cover, semanticLabel: f.name, errorBuilder: (_, _, _) => _icon(context))
              : _icon(context),
        ),
        const SizedBox(width: Gap.md),
        Expanded(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(f.name, style: context.text.bodyMedium, maxLines: 1, overflow: TextOverflow.ellipsis),
            Text(status, style: context.text.bodySmall?.copyWith(color: s == SendState.failed ? c.bad : c.text2)),
          ]),
        ),
        if (s == SendState.sending)
          const SizedBox(width: 48, height: 48, child: Center(child: SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2))))
        else if (s == SendState.waiting)
          IconButton(icon: const Icon(Icons.close), tooltip: 'Remove ${f.name}', onPressed: () => list.remove(f)),
      ]),
    );
  }

  Widget _icon(BuildContext context) =>
      Container(width: 48, height: 48, color: context.colors.surface2, child: Icon(Icons.insert_drive_file_outlined, color: context.colors.primary));
}
