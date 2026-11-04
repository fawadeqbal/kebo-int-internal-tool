import 'package:flutter/material.dart' hide Badge;
import 'package:flutter/services.dart';

import '../core/api.dart';
import '../core/json.dart';
import 'fields.dart';
import 'format.dart';
import 'theme.dart';
import 'tone.dart';
import 'widgets.dart';

/// One line of an order, offer or inquiry: its number ("2", "2.1"), what it is, and qty·unit.
class LineRow {
  const LineRow({required this.key, required this.no, required this.title, this.sub, this.values = const {}});
  final String key, no, title;
  final String? sub;

  /// What the server has for this line (received qty, packing, price…).
  final Json values;

  bool get isPart => no.contains('.');
  String get parentNo => no.split('.').first;
}

/// A chip above the lines: "Not yet", "Short", "No price".
class LineFilter {
  const LineFilter(this.label, this.test);
  final String label;
  final bool Function(LineRow row, Json value) test;
}

/// Something done to the chosen lines at once: "All in full".
class LineBulk {
  const LineBulk(this.label, this.change);
  final String label;

  /// The new values for one chosen line (null: leave it).
  final Json? Function(LineRow row, Json value) change;
}

/// Where the list stands, shown in the bar pinned at the bottom.
class LineSummary {
  const LineSummary(this.title, [this.sub]);
  final String title;
  final String? sub;
}

/// What a line screen does: the one value typed in the row, or a sheet of fields per line;
/// filters, bulk actions, totals, and how the changes are saved.
class LineSpec {
  const LineSpec({
    required this.title,
    required this.summary,
    this.subtitle,
    this.inline,
    this.fields = const [],
    this.filters = const [],
    this.bulk = const [],
    this.fillDown = false,
    this.rowText,
    this.rowTone,
    this.saveLabel,
    this.save,
    this.addLabel,
    this.addFields = const [],
  });

  final String title;
  final String? subtitle;

  /// The one number typed in the row (received qty, their price). Null: rows open a sheet.
  final FieldDef? inline;

  /// What the line sheet asks (several values a line, e.g. packing).
  final List<FieldDef> fields;
  final List<LineFilter> filters;
  final List<LineBulk> bulk;

  /// The line sheet offers "Fill down" (copy values to the lines below).
  final bool fillDown;

  /// The row's second line from its values ("4 cartons · 480 kg"); null: the line's own sub.
  final String? Function(LineRow row, Json value)? rowText;

  /// A coloured dot: done, short, missing.
  final Tone? Function(LineRow row, Json value)? rowTone;
  final LineSummary Function(List<LineRow> rows, Json Function(LineRow) valueOf) summary;

  /// Null: read only.
  final String? saveLabel;
  final Future<void> Function(Map<String, Json> changes)? save;

  /// "A line they added": new lines made on the phone.
  final String? addLabel;
  final List<FieldDef> addFields;
}

/// Opens a line screen full screen; true when something was saved.
Future<bool> openLines(BuildContext context, {required List<LineRow> rows, required LineSpec spec}) async =>
    await Navigator.of(context, rootNavigator: true).push<bool>(MaterialPageRoute(builder: (_) => LinesScreen(rows: rows, spec: spec))) ?? false;

/// Every line list on the phone: rows load as you scroll, search, filters, parts folded under
/// their line, one number typed in the row (Next › walks down), or a sheet per line with
/// ‹ previous and save & next ›, many lines at once, Fill down, and the summary with Save.
class LinesScreen extends StatefulWidget {
  const LinesScreen({super.key, required this.rows, required this.spec});
  final List<LineRow> rows;
  final LineSpec spec;

  @override
  State<LinesScreen> createState() => _LinesScreenState();
}

class _LinesScreenState extends State<LinesScreen> {
  static const extent = 72.0;
  late final List<LineRow> rows = [...widget.rows];
  final changes = <String, Json>{};
  final folded = <String>{};
  final chosen = <String>{};
  final controllers = <String, TextEditingController>{};
  final focus = <String, FocusNode>{};
  final scroll = ScrollController();
  String q = '';
  int filter = 0;
  bool busy = false;
  String? problem;

  LineSpec get spec => widget.spec;
  bool get readOnly => spec.save == null;
  bool get choosing => chosen.isNotEmpty;

  @override
  void initState() {
    super.initState();
    // Lines with parts start folded when the list is long.
    if (rows.length > 30) folded.addAll(rows.where((r) => r.isPart).map((r) => r.parentNo));
  }

  @override
  void dispose() {
    for (final c in controllers.values) {
      c.dispose();
    }
    for (final f in focus.values) {
      f.dispose();
    }
    scroll.dispose();
    super.dispose();
  }

  Json valueOf(LineRow r) => {...r.values, ...?changes[r.key]};

  void _set(LineRow r, Json v) {
    final merged = {...?changes[r.key], ...v};
    // Back to what the server has: no change.
    if (merged.entries.every((e) => '${r.values[e.key] ?? ''}' == '${e.value ?? ''}')) {
      changes.remove(r.key);
    } else {
      changes[r.key] = merged;
    }
  }

  int _parts(LineRow parent) => rows.where((r) => r.isPart && r.parentNo == parent.no).length;

  /// The rows shown: search and filter look through every line; otherwise parts fold.
  List<LineRow> get shown {
    final words = q.toLowerCase().split(RegExp(r'\s+')).where((w) => w.isNotEmpty).toList();
    final f = spec.filters.isEmpty || filter == 0 ? null : spec.filters[filter];
    return [
      for (final r in rows)
        if ((words.isEmpty || words.every('${r.no} ${r.title} ${r.sub ?? ''}'.toLowerCase().contains)) &&
            (f == null || f.test(r, valueOf(r))) &&
            (words.isNotEmpty || f != null || !r.isPart || !folded.contains(r.parentNo)))
          r,
    ];
  }

  TextEditingController _ctl(LineRow r) => controllers.putIfAbsent(r.key, () => TextEditingController(text: '${valueOf(r)[spec.inline!.key] ?? ''}'));
  FocusNode _focus(LineRow r) => focus.putIfAbsent(r.key, FocusNode.new);

  /// Next › on the keypad: the next line's box, scrolled into view first.
  void _next(List<LineRow> list, int i) {
    if (i + 1 >= list.length) {
      FocusScope.of(context).unfocus();
      return;
    }
    final target = (i + 1) * extent - 120;
    scroll.animateTo(target.clamp(0, scroll.position.maxScrollExtent), duration: const Duration(milliseconds: 150), curve: Curves.easeOut);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) _focus(list[i + 1]).requestFocus();
    });
  }

  Future<void> _save() async {
    if (busy || changes.isEmpty) return;
    setState(() {
      busy = true;
      problem = null;
    });
    try {
      await spec.save!(Map.of(changes));
      if (mounted) Navigator.pop(context, true);
    } on ApiException catch (e) {
      if (mounted) {
        setState(() {
          busy = false;
          problem = e.message;
        });
      }
    }
  }

  Future<bool> _leave() async {
    if (changes.isEmpty) return true;
    return confirmDialog(context,
        title: 'Discard ${count(changes.length, '1 change', '{} changes')}?', text: 'They are not saved yet.', yes: 'Discard', danger: true);
  }

  Future<void> _sheet(List<LineRow> list, int i) async {
    final done = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (_) => _LineSheet(
        list: list,
        start: i,
        spec: spec,
        valueOf: valueOf,
        onSave: (r, v) => setState(() {
          _set(r, v);
          // The row's box shows the sheet's value next time it is built.
          final ctl = controllers.remove(r.key);
          WidgetsBinding.instance.addPostFrameCallback((_) => ctl?.dispose());
        }),
        onFillDown: spec.fillDown ? (from, v, keys, to, onlyEmpty) => setState(() => _fillDown(from, v, keys, to, onlyEmpty)) : null,
        all: rows,
      ),
    );
    if (done == true && mounted) setState(() {});
  }

  /// Copies [keys] of [v] to the lines after [from]: [to] of them, or every one not filled.
  int _fillDown(LineRow from, Json v, Set<String> keys, int? to, bool onlyEmpty) {
    final start = rows.indexOf(from) + 1;
    var n = 0;
    for (var i = start; i < rows.length && (to == null || i < start + to); i++) {
      final r = rows[i];
      final cur = valueOf(r);
      final copy = {
        for (final k in keys)
          if (!onlyEmpty || '${cur[k] ?? ''}'.trim().isEmpty || '${cur[k]}' == '0') k: v[k],
      };
      if (copy.isEmpty) continue;
      _set(r, copy);
      controllers.remove(r.key)?.dispose();
      n++;
    }
    return n;
  }

  Future<void> _add() async {
    final ctl = <String, Object?>{};
    final ok = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (ctx) => _AddSheet(title: spec.addLabel!, fields: spec.addFields, values: ctl),
    );
    if (ok != true || !mounted) return;
    final key = 'new-${DateTime.now().microsecondsSinceEpoch}';
    final no = '+${rows.where((r) => r.key.startsWith('new-')).length + 1}';
    setState(() {
      rows.add(LineRow(key: key, no: no, title: '${ctl['description'] ?? 'New line'}', sub: joinWords(['${ctl['quantity'] ?? ''}', '${ctl['unit'] ?? ''}'])));
      changes[key] = {...ctl, '_new': true};
    });
  }

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final list = shown;
    final sum = spec.summary(rows, valueOf);
    return PopScope(
      canPop: changes.isEmpty,
      onPopInvokedWithResult: (didPop, _) async {
        if (!didPop && await _leave() && context.mounted) Navigator.pop(context, false);
      },
      child: Scaffold(
        appBar: AppBar(
          title: Semantics(
            header: true,
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(choosing ? count(chosen.length, '1 line chosen', '{} lines chosen')! : spec.title, style: context.text.titleMedium),
              if (!choosing && spec.subtitle != null)
                Text(spec.subtitle!, style: context.text.bodySmall?.copyWith(color: c.text2), maxLines: 1, overflow: TextOverflow.ellipsis),
            ]),
          ),
          actions: [
            if (choosing) TextButton(onPressed: () => setState(chosen.clear), child: const Text('Cancel')),
            if (!choosing && spec.addLabel != null && !readOnly)
              IconButton(icon: const Icon(Icons.add), tooltip: spec.addLabel, onPressed: _add),
          ],
        ),
        body: Column(children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(Gap.lg, 0, Gap.lg, Gap.xs),
            child: SearchField(hint: 'Line number, item or model', onChanged: (v) => setState(() => q = v.trim())),
          ),
          if (spec.filters.isNotEmpty)
            SizedBox(
              height: Gap.tap,
              child: ListView(scrollDirection: Axis.horizontal, padding: const EdgeInsets.symmetric(horizontal: Gap.lg), children: [
                for (final (i, f) in spec.filters.indexed)
                  Padding(
                    padding: const EdgeInsets.only(right: Gap.sm),
                    child: Center(
                      child: ChoiceChip(
                        label: Text('${f.label} ${rows.where((r) => f.test(r, valueOf(r))).length}'),
                        selected: i == filter,
                        onSelected: (_) => setState(() => filter = i),
                      ),
                    ),
                  ),
              ]),
            ),
          if (problem != null) Padding(padding: const EdgeInsets.all(Gap.lg), child: MessageBanner(problem!, tone: Tone.bad)),
          if (choosing && spec.bulk.isNotEmpty)
            Container(
              margin: const EdgeInsets.fromLTRB(Gap.lg, Gap.xs, Gap.lg, Gap.xs),
              padding: const EdgeInsets.symmetric(horizontal: Gap.sm),
              decoration: BoxDecoration(color: c.text, borderRadius: BorderRadius.circular(Gap.radius)),
              child: Row(children: [
                Expanded(child: Text(' ${chosen.length} chosen', style: context.text.labelMedium?.copyWith(color: c.bg))),
                for (final b in spec.bulk)
                  TextButton(
                    onPressed: () => setState(() {
                      for (final r in rows.where((r) => chosen.contains(r.key))) {
                        final v = b.change(r, valueOf(r));
                        if (v != null) {
                          _set(r, v);
                          controllers.remove(r.key)?.dispose();
                        }
                      }
                      chosen.clear();
                    }),
                    child: Text(b.label, style: TextStyle(color: c.bg, fontWeight: FontWeight.w600)),
                  ),
              ]),
            ),
          Expanded(
            child: list.isEmpty
                ? const EmptyState(title: 'No line matches', text: 'Try the number, a word of the item, or another filter.')
                : ListView.builder(
                    controller: scroll,
                    itemExtent: extent,
                    padding: const EdgeInsets.fromLTRB(Gap.lg, 0, Gap.lg, Gap.xl),
                    itemCount: list.length,
                    itemBuilder: (ctx, i) => _row(ctx, list, i),
                  ),
          ),
        ]),
        bottomNavigationBar: SafeArea(
          child: Container(
            padding: const EdgeInsets.fromLTRB(Gap.lg, Gap.md, Gap.lg, Gap.md),
            decoration: BoxDecoration(color: c.surface, border: Border(top: BorderSide(color: c.line))),
            child: Row(children: [
              Expanded(
                child: Semantics(
                  liveRegion: true,
                  child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Text(sum.title, style: context.text.titleSmall?.copyWith(fontWeight: FontWeight.w600)),
                    if (sum.sub != null) Text(sum.sub!, style: context.text.bodySmall?.copyWith(color: c.text2)),
                  ]),
                ),
              ),
              if (!readOnly) ...[
                const SizedBox(width: Gap.md),
                FilledButton(
                  onPressed: busy || changes.isEmpty ? null : _save,
                  child: busy
                      ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2))
                      : Text(changes.isEmpty ? (spec.saveLabel ?? 'Save') : '${spec.saveLabel ?? 'Save'} · ${changes.length}'),
                ),
              ],
            ]),
          ),
        ),
      ),
    );
  }

  Widget _row(BuildContext context, List<LineRow> list, int i) {
    final c = context.colors;
    final r = list[i];
    final v = valueOf(r);
    final parts = r.isPart ? 0 : _parts(r);
    final changed = changes.containsKey(r.key);
    final tone = spec.rowTone?.call(r, v);
    final text = spec.rowText?.call(r, v) ?? r.sub;
    final isChosen = chosen.contains(r.key);
    void tap() {
      if (choosing) {
        setState(() => isChosen ? chosen.remove(r.key) : chosen.add(r.key));
      } else if (spec.inline == null && spec.fields.isNotEmpty && !readOnly) {
        _sheet(list, i);
      } else if (spec.inline != null && !readOnly) {
        _focus(r).requestFocus();
      }
    }

    return Container(
      decoration: BoxDecoration(
        color: isChosen ? c.primarySoft : (changed ? c.primarySoft.withValues(alpha: 0.4) : null),
        border: Border(bottom: BorderSide(color: c.line)),
      ),
      padding: EdgeInsets.only(left: r.isPart ? 22 : 0),
      child: Row(children: [
        Expanded(
          child: MergeSemantics(
            child: InkWell(
              onTap: tap,
              onLongPress: readOnly || spec.bulk.isEmpty ? null : () => setState(() => chosen.add(r.key)),
              child: Row(children: [
                if (choosing) ...[
                  Icon(isChosen ? Icons.check_box : Icons.check_box_outline_blank, color: isChosen ? c.primary : c.lineStrong),
                  const SizedBox(width: Gap.sm),
                ],
                SizedBox(width: 34, child: Text(r.no, style: context.text.bodySmall?.copyWith(color: c.text2))),
                Expanded(
                  child: Column(mainAxisAlignment: MainAxisAlignment.center, crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Text(r.title, style: context.text.titleSmall, maxLines: 1, overflow: TextOverflow.ellipsis),
                    Row(children: [
                      if (text != null && text.isNotEmpty)
                        Flexible(child: Text(text, style: context.text.bodySmall?.copyWith(color: c.text2), maxLines: 1, overflow: TextOverflow.ellipsis)),
                      if (parts > 0)
                        InkWell(
                          onTap: () => setState(() => folded.contains(r.no) ? folded.remove(r.no) : folded.add(r.no)),
                          child: Padding(
                            padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                            child: Text('${folded.contains(r.no) ? '▸' : '▾'} $parts parts',
                                semanticsLabel: folded.contains(r.no) ? 'Show $parts parts' : 'Hide $parts parts',
                                style: context.text.bodySmall?.copyWith(color: c.primary, fontWeight: FontWeight.w600)),
                          ),
                        ),
                    ]),
                  ]),
                ),
                if (tone != null) ...[
                  Semantics(
                    label: switch (tone) { Tone.ok => 'done', Tone.warn => 'short or missing', Tone.bad => 'problem', _ => '' },
                    child: Container(width: 8, height: 8, decoration: BoxDecoration(color: c.fg(tone), shape: BoxShape.circle)),
                  ),
                  const SizedBox(width: Gap.sm),
                ],
                if (spec.inline == null && spec.fields.isNotEmpty && !readOnly && !choosing) Icon(Icons.edit_outlined, size: 18, color: c.muted),
              ]),
            ),
          ),
        ),
        if (spec.inline != null && spec.fields.isNotEmpty && !readOnly && !choosing)
          IconButton(
            icon: Icon(Icons.edit_outlined, size: 18, color: c.muted),
            tooltip: 'More for line ${r.no}',
            onPressed: () => _sheet(list, i),
          ),
        if (spec.inline != null && !readOnly)
          SizedBox(
            width: spec.inline!.kind == FieldKind.decimal && spec.inline!.key == 'unitPrice' ? 108 : 84,
            child: Semantics(
              label: '${spec.inline!.label} for line ${r.no}, ${r.title}${r.sub == null ? '' : ', ${r.sub}'}',
              textField: true,
              child: TextField(
              controller: _ctl(r),
              focusNode: _focus(r),
              textAlign: TextAlign.right,
              keyboardType: const TextInputType.numberWithOptions(decimal: true),
              textInputAction: i + 1 < list.length ? TextInputAction.next : TextInputAction.done,
              inputFormatters: [FilteringTextInputFormatter.allow(RegExp(r'[0-9.,]'))],
              onChanged: (s) => setState(() => _set(r, {spec.inline!.key: s.replaceAll(',', '').trim()})),
              onSubmitted: (_) => _next(list, i),
              decoration: InputDecoration(
                hintText: spec.inline!.hint ?? '',
                isDense: true,
                constraints: const BoxConstraints(minHeight: Gap.tap),
                contentPadding: const EdgeInsets.symmetric(horizontal: 10, vertical: 14),
                // Read out with the line it belongs to.
                semanticCounterText: '',
                labelText: null,
              ),
              style: context.text.bodyLarge?.copyWith(fontFeatures: const [FontFeature.tabularFigures()]),
              ),
            ),
          ),
      ]),
    );
  }
}

/// One line's fields, with ‹ previous and save & next ›, and Fill down.
class _LineSheet extends StatefulWidget {
  const _LineSheet({required this.list, required this.start, required this.spec, required this.valueOf, required this.onSave, required this.all, this.onFillDown});
  final List<LineRow> list, all;
  final int start;
  final LineSpec spec;
  final Json Function(LineRow) valueOf;
  final void Function(LineRow, Json) onSave;
  final void Function(LineRow from, Json v, Set<String> keys, int? to, bool onlyEmpty)? onFillDown;

  @override
  State<_LineSheet> createState() => _LineSheetState();
}

class _LineSheetState extends State<_LineSheet> {
  late int i = widget.start;
  late Json v = {...widget.valueOf(widget.list[i])};
  int version = 0;

  LineRow get r => widget.list[i];

  void _go(int to) {
    widget.onSave(r, v);
    if (to < 0 || to >= widget.list.length) {
      Navigator.pop(context, true);
      return;
    }
    setState(() {
      i = to;
      v = {...widget.valueOf(widget.list[i])};
      version++;
    });
  }

  Future<void> _fill() async {
    final keys = {for (final f in widget.spec.fields) if ('${v[f.key] ?? ''}'.isNotEmpty) f.key};
    var to = 'next5';
    var onlyEmpty = true;
    final ok = await showModalBottomSheet<bool>(
      context: context,
      useSafeArea: true,
      isScrollControlled: true,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, set) => SingleChildScrollView(
          padding: const EdgeInsets.fromLTRB(Gap.lg, 0, Gap.lg, Gap.lg),
          child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            Semantics(header: true, child: Text('Fill down from line ${r.no}', style: ctx.text.titleLarge)),
            const SizedBox(height: Gap.md),
            Text('Copy', style: ctx.text.labelMedium),
            Wrap(spacing: Gap.sm, children: [
              for (final f in widget.spec.fields)
                FilterChip(
                  label: Text(f.label),
                  selected: keys.contains(f.key),
                  onSelected: (on) => set(() => on ? keys.add(f.key) : keys.remove(f.key)),
                ),
            ]),
            const SizedBox(height: Gap.md),
            Text('To', style: ctx.text.labelMedium),
            Wrap(spacing: Gap.sm, children: [
              for (final e in {'next5': 'Next 5 lines', 'next10': 'Next 10 lines', 'all': 'Every line below'}.entries)
                ChoiceChip(label: Text(e.value), selected: to == e.key, onSelected: (_) => set(() => to = e.key)),
            ]),
            SwitchListTile(
              contentPadding: EdgeInsets.zero,
              title: const Text('Only empty values (filled lines keep theirs)'),
              value: onlyEmpty,
              onChanged: (b) => set(() => onlyEmpty = b),
            ),
            FilledButton(onPressed: keys.isEmpty ? null : () => Navigator.pop(ctx, true), child: const Text('Fill down')),
          ]),
        ),
      ),
    );
    if (ok != true || !mounted) return;
    widget.onSave(r, v);
    widget.onFillDown!(r, v, keys, to == 'next5' ? 5 : to == 'next10' ? 10 : null, onlyEmpty);
    if (mounted) toast(context, 'Filled down');
  }

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final last = i == widget.list.length - 1;
    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(context).bottom),
      child: SingleChildScrollView(
        padding: const EdgeInsets.fromLTRB(Gap.lg, 0, Gap.lg, Gap.lg),
        child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Semantics(header: true, child: Text('Line ${r.no} · ${i + 1} of ${widget.list.length}', style: context.text.titleLarge)),
          Text(joinParts([r.title, r.sub]), style: context.text.bodySmall?.copyWith(color: c.text2)),
          const SizedBox(height: Gap.md),
          for (final f in widget.spec.fields) ...[
            FieldEditor(key: ValueKey('$version.${f.key}'), def: f, value: v[f.key], onChanged: (x) => setState(() => v[f.key] = x)),
            const SizedBox(height: Gap.md),
          ],
          if (widget.onFillDown != null && i < widget.all.length - 1)
            Align(
              alignment: Alignment.centerLeft,
              child: TextButton.icon(onPressed: _fill, icon: const Icon(Icons.south, size: 18), label: const Text('Fill down to the lines below')),
            ),
          const SizedBox(height: Gap.sm),
          Row(children: [
            Expanded(child: OutlinedButton(onPressed: i == 0 ? null : () => _go(i - 1), child: Text(i == 0 ? 'First line' : '‹ Line ${widget.list[i - 1].no}'))),
            const SizedBox(width: Gap.md),
            Expanded(flex: 2, child: FilledButton(onPressed: () => _go(last ? -1 : i + 1), child: Text(last ? 'Done' : 'Save & line ${widget.list[i + 1].no} ›'))),
          ]),
        ]),
      ),
    );
  }
}

/// A new line made on the phone (e.g. one the factory added).
class _AddSheet extends StatefulWidget {
  const _AddSheet({required this.title, required this.fields, required this.values});
  final String title;
  final List<FieldDef> fields;
  final Map<String, Object?> values;

  @override
  State<_AddSheet> createState() => _AddSheetState();
}

class _AddSheetState extends State<_AddSheet> {
  final errors = <String, String>{};

  @override
  Widget build(BuildContext context) => Padding(
        padding: EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(context).bottom),
        child: SingleChildScrollView(
          padding: const EdgeInsets.fromLTRB(Gap.lg, 0, Gap.lg, Gap.lg),
          child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            Semantics(header: true, child: Text(widget.title, style: context.text.titleLarge)),
            const SizedBox(height: Gap.md),
            for (final f in widget.fields) ...[
              FieldEditor(def: f, value: widget.values[f.key], error: errors[f.key], onChanged: (x) => setState(() => widget.values[f.key] = x)),
              const SizedBox(height: Gap.md),
            ],
            FilledButton(
              onPressed: () {
                errors.clear();
                for (final f in widget.fields) {
                  final e = f.check(widget.values[f.key]);
                  if (e != null) errors[f.key] = e;
                }
                if (errors.isEmpty) {
                  Navigator.pop(context, true);
                } else {
                  setState(() {});
                }
              },
              child: const Text('Add the line'),
            ),
          ]),
        ),
      );
}

/// Sends [items] in batches of [size] (the API takes up to 300 lines a call).
Future<void> inBatches<T>(List<T> items, Future<void> Function(List<T> batch) send, {int size = 300}) async {
  for (var i = 0; i < items.length; i += size) {
    await send(items.sublist(i, i + size > items.length ? items.length : i + size));
  }
}
