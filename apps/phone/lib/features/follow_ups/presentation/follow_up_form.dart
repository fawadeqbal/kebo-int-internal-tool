import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/api.dart';
import '../../../core/company_time.dart';
import '../../../core/format.dart';
import '../../../core/json.dart';
import '../../../core/providers.dart';
import '../../../design/design.dart';

/// Plan a follow-up (a call, visit or meeting) on a record, or change one. [existing] is
/// the follow-up's JSON when editing. [target] is e.g. `('inquiryId', id)`. True when saved.
Future<bool> openFollowUpForm(BuildContext context, {(String, String)? target, String? about, Json? existing}) async {
  final r = await showKSheet<bool>(
    context,
    title: existing == null ? 'Plan a follow-up' : 'Change follow-up',
    builder: (_) => _FollowUpForm(target: target, about: about, existing: existing),
  );
  return r == true;
}

class _FollowUpForm extends ConsumerStatefulWidget {
  const _FollowUpForm({this.target, this.about, this.existing});
  final (String, String)? target;
  final String? about;
  final Json? existing;

  @override
  ConsumerState<_FollowUpForm> createState() => _FollowUpFormState();
}

class _FollowUpFormState extends ConsumerState<_FollowUpForm> {
  late final Json? e = widget.existing;
  late final _title = TextEditingController(text: e?.strOrNull('title'));
  late final _place = TextEditingController(text: e?.strOrNull('place'));
  late final _note = TextEditingController(text: e?.strOrNull('note'));
  late String _kind = e?.strOrNull('kind') ?? 'call';
  late DateTime _on =
      DateTime.tryParse(e?.strOrNull('dueOn') ?? '') ?? CompanyTime.today().add(const Duration(days: 1));
  late TimeOfDay? _at = _parseTime(e?.strOrNull('dueAt'));
  bool _busy = false;
  String? _error;
  Map<String, String> _fields = const {};

  static const kinds = {'call': 'Call', 'visit': 'Visit', 'meeting': 'Meeting', 'other': 'Other'};

  static TimeOfDay? _parseTime(String? s) {
    final m = RegExp(r'^(\d{1,2}):(\d{2})').firstMatch(s ?? '');
    return m == null ? null : TimeOfDay(hour: int.parse(m[1]!), minute: int.parse(m[2]!));
  }

  String? get _atText =>
      _at == null ? null : '${_at!.hour.toString().padLeft(2, '0')}:${_at!.minute.toString().padLeft(2, '0')}';

  @override
  void dispose() {
    for (final c in [_title, _place, _note]) {
      c.dispose();
    }
    super.dispose();
  }

  Api get _api => ref.read(sessionProvider.notifier).api;

  Future<void> _save() async {
    if (_title.text.trim().isEmpty) {
      KHaptics.error();
      setState(() => _fields = {'title': 'Say what to do, e.g. "Call about the price".'});
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
      _fields = const {};
    });
    final body = <String, Object?>{
      'title': _title.text.trim(),
      'kind': _kind,
      'dueOn': isoDay(_on),
      'dueAt': _atText,
      'place': _place.text.trim().isEmpty ? null : _place.text.trim(),
      'note': _note.text.trim().isEmpty ? null : _note.text.trim(),
      if (e == null && widget.target != null) widget.target!.$1: widget.target!.$2,
    };
    try {
      if (e == null) {
        await _api.post('/api/follow-ups', body);
      } else {
        await _api.patch('/api/follow-ups/${e!.str('id')}', body);
      }
      KHaptics.success();
      if (mounted) Navigator.of(context).pop(true);
    } on ApiException catch (x) {
      if (mounted) {
        setState(() {
          _busy = false;
          _fields = x.fieldErrors;
          _error = x.fieldErrors.isEmpty ? x.message : null;
        });
      }
    }
  }

  Future<void> _delete() async {
    final ok = await showKConfirm(
      context,
      title: 'Delete this follow-up?',
      message: _title.text,
      confirmLabel: 'Delete',
      destructive: true,
    );
    if (ok != true) return;
    try {
      await _api.delete('/api/follow-ups/${e!.str('id')}');
      if (mounted) Navigator.of(context).pop(true);
    } on ApiException catch (x) {
      setState(() => _error = x.message);
    }
  }

  @override
  Widget build(BuildContext context) {
    final c = context.k;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (widget.about != null) ...[
          Text(widget.about!, style: KType.callout.copyWith(color: c.inkMuted)),
          const SizedBox(height: KSpace.s3),
        ],
        if (_error != null) ...[KBanner(_error!, tone: KTone.danger), const SizedBox(height: KSpace.s3)],
        Wrap(
          spacing: KSpace.s2,
          children: [
            for (final k in kinds.entries)
              KChip(k.value, selected: _kind == k.key, onPressed: () => setState(() => _kind = k.key)),
          ],
        ),
        const SizedBox(height: KSpace.s4),
        KTextField(
          label: 'What to do',
          controller: _title,
          hint: 'Call Dr. Noori about the price',
          error: _fields['title'],
        ),
        const SizedBox(height: KSpace.s4),
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(
              flex: 3,
              child: KSelectField(
                label: 'On',
                value: fmtDate(_on),
                icon: KIcons.calendar,
                error: _fields['dueOn'],
                onTap: () async {
                  final d = await showDatePicker(
                    context: context,
                    initialDate: _on,
                    firstDate: CompanyTime.today().subtract(const Duration(days: 30)),
                    lastDate: CompanyTime.today().add(const Duration(days: 730)),
                  );
                  if (d != null) setState(() => _on = d);
                },
              ),
            ),
            const SizedBox(width: KSpace.s3),
            Expanded(
              flex: 2,
              child: KSelectField(
                label: 'At',
                value: _atText,
                placeholder: 'Any time',
                icon: KIcons.clock,
                onTap: () async {
                  final t = await showTimePicker(
                    context: context,
                    initialTime: _at ?? const TimeOfDay(hour: 10, minute: 0),
                  );
                  if (t != null) setState(() => _at = t);
                },
              ),
            ),
          ],
        ),
        if (_at != null)
          Align(
            alignment: Alignment.centerRight,
            child: KButton(
              'No set time',
              variant: KButtonVariant.tertiary,
              onPressed: () => setState(() => _at = null),
            ),
          ),
        const SizedBox(height: KSpace.s4),
        if (_kind == 'visit' || _kind == 'meeting' || _place.text.isNotEmpty) ...[
          KTextField(label: 'Where', controller: _place, optional: true),
          const SizedBox(height: KSpace.s4),
        ],
        KTextField(label: 'Note', controller: _note, optional: true, multiline: true),
        const SizedBox(height: KSpace.s6),
        KButton(e == null ? 'Plan it' : 'Save changes', fullWidth: true, loading: _busy, onPressed: _save),
        if (e != null) ...[
          const SizedBox(height: KSpace.s2),
          KButton('Delete', variant: KButtonVariant.tertiary, fullWidth: true, onPressed: _busy ? null : _delete),
        ],
      ],
    );
  }
}
