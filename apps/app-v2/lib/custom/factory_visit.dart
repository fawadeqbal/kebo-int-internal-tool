import 'package:flutter/material.dart' hide Badge;

import '../core/api.dart';
import '../core/json.dart';
import '../core/outbox.dart';
import '../core/scope.dart';
import '../ds/ds.dart';
import '../generated/models.g.dart';
import 'money.dart' show canAddExpense, openExpense;
import 'waiting.dart';

String _today() => isoDay(DateTime.now())!;

const _fatResults = {'Passed': 'Passed', 'Passed with notes': 'Passed with notes', 'Failed': 'Failed'};

/// At the factory: the ready date they give now, the FAT result and notes, photos, and the
/// visit's costs. One Save; each answer goes where it lives. True when saved.
Future<bool> openFactoryVisit(BuildContext context, Order order) async {
  final api = context.api;
  final Json flow;
  final Json? fat;
  try {
    final r = await Future.wait([api.get('/api/orders/${order.id}/flow'), api.get('/api/orders/${order.id}/steps')]);
    flow = r[0];
    // The company's own FAT item: the one that makes the FAT report.
    fat = r[1].list('items', (m) => m).where((i) => i.strOrNull('paper') == 'fat-report' && i.strOrNull('id') != null).firstOrNull;
  } on ApiException catch (e) {
    if (context.mounted) toast(context, e.message);
    return false;
  }
  if (!context.mounted) return false;
  final readyBy = flow.listAt('factory.readyBy');
  final factories = {for (final f in flow.listAt('factory.factories')) f.str('id'): f.str('name')};
  if (factories.isEmpty) {
    for (final f in readyBy) {
      factories[f.str('factoryId')] = f.str('name');
    }
  }
  String? readyOf(Object? id) => readyBy.where((f) => f.str('factoryId') == id).firstOrNull?.strOrNull('readyOn');
  final first = factories.keys.firstOrNull;
  final fatDone = fat?.boolean('done') ?? false;
  PickedFile? photo;
  Sent? sent;
  final box = context.outbox;

  final ok = await FormSheet.open(
    context,
    title: 'Factory visit',
    save: 'Save the visit',
    keeps: true,
    intro: joinParts([order.refNo, order.customer?.name, if (fatDone) 'FAT already recorded']),
    initial: {'factoryId': first, 'readyOn': readyOf(first), 'result': null, 'note': fat?.strOrNull('note') ?? ''},
    groups: [
      FormGroup(fields: [
        if (factories.length > 1) FieldDef('factoryId', 'Factory', FieldKind.choice, required: true, options: factories),
        FieldDef('readyOn', 'Factory says ready on', FieldKind.date, hint: 'The payment plans that follow the ready date move with it'),
      ]),
      if (fat != null && !fatDone)
        FormGroup(title: 'FAT', fields: [
          FieldDef('result', 'Result', FieldKind.choice, options: _fatResults),
          const FieldDef('note', 'Notes', FieldKind.multiline, max: 1000, hint: 'e.g. speed 98 bpm at test, label alignment ok'),
        ]),
    ],
    onChange: (v, key) {
      if (key == 'factoryId') v['readyOn'] = readyOf(v['factoryId']);
    },
    live: (v) {
      final was = readyOf(v['factoryId']);
      if (was == null || v['readyOn'] == was || v['readyOn'] == null) return const SizedBox.shrink();
      return MessageBanner('Was ${fmtDate(DateTime.parse(was))} · the plans move with it', tone: Tone.info);
    },
    extra: (setState) => Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      FileTile(label: 'Photo', add: 'Take a photo at the factory', picked: photo, onPicked: (p) => setState(() => photo = p), hint: 'Saved with the order\'s production files'),
      if (canAddExpense(context)) ...[
        const SizedBox(height: Gap.md),
        Align(
          alignment: Alignment.centerLeft,
          child: TextButton.icon(
            onPressed: () => openExpense(context, orderId: order.id, refNo: order.refNo, customer: order.customer?.name),
            icon: const Icon(Icons.add, size: 18),
            label: const Text('Visit expense (taxi, hotel…)'),
          ),
        ),
      ],
    ]),
    send: (api, body) async {
      // One chain: sent now, or kept on the phone with no signal and sent in this order later.
      final factoryId = body['factoryId'] as String? ?? first;
      final ch = box.chain(joinParts(['Factory visit', order.refNo, factories[factoryId]]));
      // The ready date first: it may ask why it moved (the form asks and sends again).
      final was = readyOf(factoryId);
      if (factoryId != null && body['readyOn'] != null && body['readyOn'] != was) {
        ch.patch(
          '/api/orders/${order.id}/details',
          {
            'readyBy': [
              {'factoryId': factoryId, 'readyOn': body['readyOn']},
            ],
            if (body['reason'] != null) 'reason': body['reason'],
          },
          // Sent later: first check nobody moved it meanwhile ("Changed by someone else").
          guard: {'get': '/api/orders/${order.id}/flow', 'list': 'factory.readyBy', 'where': {'factoryId': factoryId}, 'field': 'readyOn', 'was': was, 'yours': body['readyOn']},
        );
      }
      OutStep? up;
      if (photo != null) {
        up = ch.upload('/api/orders/${order.id}/files', photo!.bytes, photo!.name,
            fields: {'step': 'production', 'kind': 'photo', 'note': 'Factory visit ${factories[factoryId] ?? ''}'.trim()}, idAt: 'sourceId');
      }
      if (fat != null && !fatDone && body['result'] != null) {
        ch.post('/api/checklist/${fat.str('id')}/tick', {
          'data': {'date': _today(), 'result': body['result']},
          if (up != null) 'attachmentId': Chain.ref(up),
        });
      }
      if (fat != null && '${body['note'] ?? ''}'.trim() != (fat.strOrNull('note') ?? '')) {
        ch.patch('/api/checklist/${fat.str('id')}', {'note': '${body['note']}'.trim()});
      }
      sent = await ch.send();
      photo = null; // sent or kept: not again if the form sends a second time
      return null;
    },
  );
  if (ok && context.mounted) savedToast(context, sent ?? const Sent(queued: false), 'Visit saved');
  return ok;
}
