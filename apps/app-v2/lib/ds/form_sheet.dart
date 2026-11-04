import 'dart:async';

import 'package:flutter/material.dart';

import '../core/api.dart';
import '../core/json.dart';
import '../core/scope.dart';
import 'fields.dart';
import 'format.dart';
import 'items_editor.dart';
import 'theme.dart';
import 'tone.dart';
import 'widgets.dart';

/// Repeating items inside a form, e.g. a customer's contacts.
class ListDef {
  const ListDef(this.key,
      {required this.itemLabel,
      required this.addLabel,
      required this.fields,
      required this.blank,
      this.min = 0,
      this.rules = const [],
      this.asLines = false});

  /// Long lists (items, lines): a summary here and a full-screen editor, not a card per item.
  final bool asLines;
  final String key, itemLabel, addLabel;
  final int min;
  final List<FieldDef> fields;
  final List<AnyOf> rules;
  final Json Function() blank;
}

/// A group of fields under an optional title; [folded] groups start closed.
class FormGroup {
  const FormGroup({this.title, this.fields = const [], this.list, this.folded = false});
  final String? title;
  final List<FieldDef> fields;
  final ListDef? list;
  final bool folded;
}

/// Every add and edit: a sheet from the bottom with labelled fields and one Save.
class FormSheet extends StatefulWidget {
  const FormSheet._({
    required this.title,
    required this.save,
    required this.groups,
    required this.initial,
    required this.send,
    this.rules = const [],
    this.duplicateFlag,
    this.intro,
    this.danger = false,
    this.extra,
    this.live,
    this.onChange,
    this.keeps = false,
  });

  /// Kept on the phone when there is no signal: Save then says "Save · sends when online".
  final bool keeps;

  /// A summary under the fields that follows what is typed (e.g. "Left due USD 0.00").
  final Widget Function(Json values)? live;

  /// Called after a field changes, to fill others from it (e.g. the rate when the currency changes).
  final FutureOr<void> Function(Json values, String key)? onChange;

  /// More under the fields that keeps its own state (e.g. a photo to attach).
  final Widget Function(StateSetter setState)? extra;

  /// Red Save: it ends or removes something.
  final bool danger;

  final String title, save;

  /// A line under the title saying what saving does ("This makes the order…").
  final String? intro;
  final List<FormGroup> groups;
  final List<AnyOf> rules;
  final Json initial;
  final Future<Object?> Function(Api api, Json body) send;

  /// When the server answers 409 "duplicate", the matches are shown and
  /// "Save anyway" sends again with this flag set.
  final String? duplicateFlag;

  /// Shows the form; true when it was saved.
  static Future<bool> open(
    BuildContext context, {
    required String title,
    required String save,
    required List<FormGroup> groups,
    required Json initial,
    required Future<Object?> Function(Api api, Json body) send,
    List<AnyOf> rules = const [],
    String? duplicateFlag,
    String? intro,
    bool danger = false,
    Widget Function(StateSetter setState)? extra,
    Widget Function(Json values)? live,
    FutureOr<void> Function(Json values, String key)? onChange,
    bool keeps = false,
  }) async {
    final saved = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      useRootNavigator: true,
      isDismissible: false,
      builder: (_) => FormSheet._(
        title: title,
        save: save,
        groups: groups,
        initial: initial,
        send: send,
        rules: rules,
        duplicateFlag: duplicateFlag,
        intro: intro,
        danger: danger,
        extra: extra,
        live: live,
        onChange: onChange,
        keeps: keeps,
      ),
    );
    return saved ?? false;
  }

  @override
  State<FormSheet> createState() => _FormSheetState();
}

class _FormSheetState extends State<FormSheet> {
  late final Json values = _copy(widget.initial);
  late final Set<String> open = {for (final g in widget.groups) if (!g.folded && g.title != null) g.title!};
  final errors = <String, String>{};
  String? problem;
  bool busy = false;
  bool changed = false;

  static Json _copy(Json j) => {
        for (final e in j.entries)
          e.key: e.value is List ? [for (final x in e.value as List<dynamic>) x is Json ? _copy(x) : x] : e.value,
      };

  List<Json> _items(String key) => [for (final x in (values[key] as List<dynamic>? ?? const [])) x as Json];

  void _set(Json target, String key, Object? v) => setState(() {
        target[key] = v;
        changed = true;
        if (identical(target, values)) {
          final r = widget.onChange?.call(values, key);
          if (r is Future) r.then((_) => mounted ? setState(() {}) : null);
        }
      });

  /// Checks everything; fills [errors] and opens the groups that have one.
  bool _check() {
    errors.clear();
    void checkFields(Json src, List<FieldDef> defs, List<AnyOf> rules, String prefix) {
      for (final d in defs.where((d) => d.shownIn(src))) {
        final e = d.check(src[d.key]);
        if (e != null) errors['$prefix${d.key}'] = e;
      }
      for (final r in rules) {
        if (!r.ok(src)) errors.putIfAbsent('$prefix${r.keys.first}', () => r.message);
      }
    }

    for (final g in widget.groups) {
      if (g.list != null) {
        final items = _items(g.list!.key);
        if (items.length < g.list!.min) errors[g.list!.key] = 'Add at least ${g.list!.min} ${g.list!.itemLabel.toLowerCase()}';
        for (final (i, item) in items.indexed) {
          checkFields(item, g.list!.fields, g.list!.rules, '${g.list!.key}.$i.');
        }
      } else {
        checkFields(values, g.fields, const [], '');
      }
    }
    checkFields(values, const [], widget.rules, '');
    for (final g in widget.groups) {
      final keys = g.list != null ? [g.list!.key] : g.fields.map((f) => f.key);
      if (g.title != null && errors.keys.any((k) => keys.any((f) => k == f || k.startsWith('$f.')))) open.add(g.title!);
    }
    return errors.isEmpty;
  }

  Future<void> _save({bool anyway = false, String? reason}) async {
    if (busy) return;
    final ok = _check();
    setState(() => problem = ok ? null : 'Some details need fixing. They are marked below.');
    if (!ok) return;
    setState(() => busy = true);
    final body = _copy(values);
    // Fields not shown are not sent (two fields may share a key, e.g. an account per currency).
    final fields = [for (final g in widget.groups) ...g.fields];
    final shown = {for (final d in fields.where((d) => d.shownIn(values))) d.key};
    for (final d in fields.where((d) => !shown.contains(d.key))) {
      body.remove(d.key);
    }
    for (final e in body.entries.toList()) {
      if (e.value is String) body[e.key] = (e.value as String).trim();
    }
    if (anyway && widget.duplicateFlag != null) body[widget.duplicateFlag!] = true;
    if (reason != null) body['reason'] = reason;
    try {
      await widget.send(context.api, body);
      if (mounted) Navigator.pop(context, true);
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() {
        busy = false;
        errors.addAll(e.fieldErrors);
        problem = e.message;
      });
      if (e.code == 'reason_needed') {
        final why = await askReason(context, e);
        if (why != null && mounted) await _save(anyway: anyway, reason: why);
        return;
      }
      if (e.code == 'duplicate' && widget.duplicateFlag != null) {
        final lines = e.matches.map((m) => '• ${m.str('label')} — ${m.str('detail')}').join('\n');
        final go = await confirmDialog(context, title: 'Already known?', text: '${e.message}\n\n$lines', yes: 'Save anyway');
        if (go && mounted) await _save(anyway: true);
      }
    }
  }

  Future<void> _close() async {
    if (!changed || await confirmDialog(context, title: 'Discard changes?', text: 'What you typed is not saved.', yes: 'Discard', danger: true)) {
      if (mounted) Navigator.pop(context, false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final inset = MediaQuery.viewInsetsOf(context).bottom;
    return PopScope(
      canPop: !changed,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) _close();
      },
      child: SizedBox(
        height: MediaQuery.sizeOf(context).height * 0.92,
        child: Column(children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(Gap.lg, 0, Gap.xs, Gap.xs),
            child: Row(children: [
              Expanded(child: Semantics(header: true, child: Text(widget.title, style: context.text.titleLarge))),
              IconButton(icon: const Icon(Icons.close), tooltip: 'Close', onPressed: _close),
            ]),
          ),
          Divider(height: 1, color: c.line),
          Expanded(
            child: ListView(
              padding: const EdgeInsets.all(Gap.lg),
              children: [
                if (widget.intro != null) ...[
                  Text(widget.intro!, style: context.text.bodyMedium?.copyWith(color: c.text2)),
                  const SizedBox(height: Gap.lg),
                ],
                if (problem != null) ...[MessageBanner(problem!, tone: Tone.bad), const SizedBox(height: Gap.lg)],
                for (final g in widget.groups) ..._group(context, g),
                if (widget.live != null) ...[widget.live!(values), const SizedBox(height: Gap.lg)],
                if (widget.extra != null) widget.extra!(setState),
              ],
            ),
          ),
          Container(
            padding: EdgeInsets.fromLTRB(Gap.lg, Gap.md, Gap.lg, Gap.md + (inset > 0 ? 0 : MediaQuery.paddingOf(context).bottom)),
            decoration: BoxDecoration(color: c.surface, border: Border(top: BorderSide(color: c.line))),
            child: SizedBox(
              width: double.infinity,
              child: FilledButton(
                style: widget.danger ? FilledButton.styleFrom(backgroundColor: c.badSolid) : null,
                onPressed: busy ? null : _save,
                child: busy
                    ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2))
                    : ListenableBuilder(
                        listenable: context.net,
                        builder: (context, _) => Text(widget.keeps && context.net.offline ? 'Save · sends when online' : widget.save),
                      ),
              ),
            ),
          ),
        ]),
      ),
    );
  }

  List<Widget> _group(BuildContext context, FormGroup g) {
    final c = context.colors;
    final body = <Widget>[];
    if (g.list != null && g.list!.asLines) {
      final l = g.list!;
      final items = _items(l.key);
      final tops = items.where((i) => i['parentId'] == null && i['partOf'] == null && i['_parent'] == null).length;
      final bad = errors.keys.any((k) => k == l.key || k.startsWith('${l.key}.'));
      if (bad) body.add(Text(errors[l.key] ?? 'Some items need fixing: open them', style: context.text.bodySmall?.copyWith(color: c.bad)));
      for (final (i, it) in items.take(3).indexed) {
        body.add(PhoneRow(
          RowData(title: '${it['no'] ?? i + 1}  ${it['description'] ?? ''}', sub: [joinWords(['${it['quantity'] ?? ''}', '${it['unit'] ?? ''}'])]),
          divider: i < items.length - 1 && i < 2,
        ));
      }
      body.add(Align(
        alignment: Alignment.centerLeft,
        child: OutlinedButton.icon(
          icon: Icon(items.isEmpty ? Icons.add : Icons.list, size: 18),
          label: Text(items.isEmpty ? l.addLabel : 'All ${count(tops, '1 item', '{} items')} · edit ›'),
          onPressed: () async {
            final next = await openItems(context, items: items, fields: l.fields, blank: l.blank, title: g.title ?? l.itemLabel);
            if (next != null) _set(values, l.key, next);
          },
        ),
      ));
    } else if (g.list != null) {
      final l = g.list!;
      final items = _items(l.key);
      if (errors[l.key] != null) body.add(Text(errors[l.key]!, style: context.text.bodySmall?.copyWith(color: c.bad)));
      for (final (i, item) in items.indexed) {
        body.add(Container(
          margin: const EdgeInsets.only(bottom: Gap.md),
          padding: const EdgeInsets.fromLTRB(Gap.md, Gap.xs, Gap.md, Gap.md),
          decoration: BoxDecoration(border: Border.all(color: c.line), borderRadius: BorderRadius.circular(Gap.radius)),
          child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            Row(children: [
              Expanded(child: Text('${l.itemLabel} ${i + 1}', style: context.text.labelMedium?.copyWith(color: c.text2))),
              if (items.length > l.min)
                TextButton(
                  onPressed: () => setState(() {
                    (values[l.key] as List<dynamic>).removeAt(i);
                    changed = true;
                  }),
                  child: Text('Remove', style: TextStyle(color: c.bad)),
                ),
            ]),
            for (final d in l.fields) ...[
              FieldEditor(
                key: ValueKey('${l.key}.${identityHashCode(item)}.${d.key}'),
                def: d,
                value: item[d.key],
                error: errors['${l.key}.$i.${d.key}'],
                onChanged: (v) => _set(item, d.key, v),
              ),
              const SizedBox(height: Gap.md),
            ],
          ]),
        ));
      }
      body.add(Align(
        alignment: Alignment.centerLeft,
        child: OutlinedButton.icon(
          icon: const Icon(Icons.add, size: 18),
          label: Text(l.addLabel),
          onPressed: () => setState(() {
            values[l.key] = [..._items(l.key), l.blank()];
            changed = true;
          }),
        ),
      ));
    } else {
      for (final d in g.fields.where((d) => d.shownIn(values))) {
        body
          ..add(FieldEditor(key: ValueKey('field.${d.key}'), def: d, value: values[d.key], error: errors[d.key], onChanged: (v) => _set(values, d.key, v)))
          ..add(const SizedBox(height: Gap.lg));
      }
    }
    if (g.title == null) return body;
    final isOpen = open.contains(g.title);
    return [
      const SizedBox(height: Gap.xs),
      Semantics(
        header: true,
        expanded: g.folded ? isOpen : null,
        child: InkWell(
          onTap: g.folded ? () => setState(() => isOpen ? open.remove(g.title) : open.add(g.title!)) : null,
          child: SizedBox(
            height: Gap.tap,
            child: Row(children: [
              Expanded(child: Text(g.title!, style: context.text.titleMedium)),
              if (g.folded) Icon(isOpen ? Icons.expand_less : Icons.expand_more, color: c.text2),
            ]),
          ),
        ),
      ),
      if (!g.folded || isOpen) ...body else const SizedBox(height: Gap.sm),
    ];
  }
}


/// The server wants to know why something already used is changed (409 "reason_needed"):
/// its question, its quick choices as chips, or the person's own words. Null when cancelled.
Future<String?> askReason(BuildContext context, ApiException e) {
  final choices = [for (final c in (e.data['choices'] as List<dynamic>? ?? const [])) '$c'];
  final ctl = TextEditingController();
  return showDialog<String>(
    context: context,
    builder: (ctx) => StatefulBuilder(
      builder: (ctx, setState) => AlertDialog(
        title: Text('Why the change?', style: ctx.text.titleMedium),
        content: SingleChildScrollView(
          child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            Text(e.message, style: ctx.text.bodyMedium),
            const SizedBox(height: Gap.md),
            Wrap(spacing: Gap.sm, runSpacing: Gap.xs, children: [
              for (final c in choices) ActionChip(label: Text(c), onPressed: () => setState(() => ctl.text = c)),
            ]),
            const SizedBox(height: Gap.sm),
            TextField(controller: ctl, maxLength: 500, decoration: const InputDecoration(hintText: 'Or write why')),
          ]),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancel')),
          FilledButton(
            onPressed: () => ctl.text.trim().isEmpty ? null : Navigator.pop(ctx, ctl.text.trim()),
            child: const Text('Save with this reason'),
          ),
        ],
      ),
    ),
  ).whenComplete(ctl.dispose);
}
