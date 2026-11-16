import 'package:flutter/material.dart';

import '../../../core/api.dart';
import '../../../core/company_time.dart';
import '../../../core/format.dart';
import '../../../core/json.dart';
import '../../../design/design.dart';
import '../../home/data/home_data.dart';

/// A follow-up due today (or late), with Done at hand. The last open follow-up of an open
/// inquiry asks for the next one, so no inquiry is left with nothing planned.
class FollowUpRow extends StatelessWidget {
  const FollowUpRow({
    super.key,
    required this.f,
    required this.api,
    required this.onChanged,
    required this.onOpen,
    this.divider = true,
  });

  final FollowUp f;
  final Api api;
  final VoidCallback onChanged;
  final VoidCallback onOpen;
  final bool divider;

  @override
  Widget build(BuildContext context) {
    final c = context.k;
    final when = [
      if (f.late) 'Late',
      if (f.dueAt != null) f.dueAt! else 'Today',
      if (f.place != null) f.place!,
    ].join(' · ');
    return KListItem(
      leading: Container(
        width: 36,
        height: 36,
        decoration: BoxDecoration(color: f.late ? c.dangerSoft : c.primarySoft, shape: BoxShape.circle),
        child: KIcon(
          f.late ? KIcons.warning : KIcons.clock,
          size: 18,
          color: f.late ? c.onDangerSoft : c.onPrimarySoft,
        ),
      ),
      title: f.title,
      subtitle: f.target,
      meta: when,
      divider: divider,
      chevron: false,
      onPressed: onOpen,
      trailing: f.canDone ? KButton('Done', variant: KButtonVariant.secondary, onPressed: () => _done(context)) : null,
    );
  }

  Future<void> _done(BuildContext context) async {
    var dirty = false;
    final done = await showKSheet<bool>(
      context,
      title: f.needsNext ? 'Done, and what next?' : 'Mark as done',
      unsaved: () => dirty,
      builder: (_) => _DoneSheet(f: f, api: api, onDirty: () => dirty = true),
    );
    if (done == true && context.mounted) {
      showKToast(context, 'Done: ${f.title}', icon: KIcons.check);
      onChanged();
    }
  }
}

/// The sheet's form. It owns its fields, so they live exactly as long as the sheet.
class _DoneSheet extends StatefulWidget {
  const _DoneSheet({required this.f, required this.api, required this.onDirty});
  final FollowUp f;
  final Api api;
  final VoidCallback onDirty;

  @override
  State<_DoneSheet> createState() => _DoneSheetState();
}

class _DoneSheetState extends State<_DoneSheet> {
  final _note = TextEditingController();
  final _nextTitle = TextEditingController();
  late DateTime? _nextDay = widget.f.needsNext ? CompanyTime.today().add(const Duration(days: 2)) : null;
  String? _problem;
  bool _busy = false;

  @override
  void dispose() {
    _note.dispose();
    _nextTitle.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    setState(() {
      _busy = true;
      _problem = null;
    });
    try {
      await widget.api.post('/api/follow-ups/${widget.f.id}/done', {
        if (_note.text.trim().isNotEmpty) 'note': _note.text.trim(),
        if (widget.f.needsNext)
          'next': {'dueOn': isoDay(_nextDay), if (_nextTitle.text.trim().isNotEmpty) 'title': _nextTitle.text.trim()},
      });
      KHaptics.success();
      if (mounted) Navigator.of(context).pop(true);
    } on ApiException catch (e) {
      if (mounted) {
        setState(() {
          _busy = false;
          _problem = e.message;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final f = widget.f;
    final c = context.k;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(f.title, style: KType.bodyStrong.copyWith(color: c.ink)),
        if (f.target != null) Text(f.target!, style: KType.callout.copyWith(color: c.inkMuted)),
        const SizedBox(height: KSpace.s4),
        if (_problem != null) ...[KBanner(_problem!, tone: KTone.danger), const SizedBox(height: KSpace.s3)],
        KTextField(
          label: 'What happened',
          controller: _note,
          optional: true,
          multiline: true,
          hint: 'Called, they want the price by Friday',
          onChanged: (_) => widget.onDirty(),
        ),
        if (f.needsNext) ...[
          const SizedBox(height: KSpace.s4),
          Text(
            'This inquiry has nothing else planned. Set the next follow-up.',
            style: KType.callout.copyWith(color: c.inkMuted),
          ),
          const SizedBox(height: KSpace.s3),
          KTextField(
            label: 'Next follow-up',
            controller: _nextTitle,
            optional: true,
            hint: 'Same as this one',
            onChanged: (_) => widget.onDirty(),
          ),
          const SizedBox(height: KSpace.s4),
          KSelectField(
            label: 'On',
            value: fmtDate(_nextDay),
            icon: KIcons.calendar,
            onTap: () async {
              final d = await showDatePicker(
                context: context,
                initialDate: _nextDay ?? CompanyTime.today(),
                firstDate: CompanyTime.today(),
                lastDate: CompanyTime.today().add(const Duration(days: 365)),
              );
              if (d != null) setState(() => _nextDay = d);
            },
          ),
        ],
        const SizedBox(height: KSpace.s6),
        KButton('Mark as done', fullWidth: true, loading: _busy, onPressed: _save),
      ],
    );
  }
}
