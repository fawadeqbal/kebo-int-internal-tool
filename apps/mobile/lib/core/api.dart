import 'dart:convert';

import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';
import 'package:path_provider/path_provider.dart';

import 'json.dart';

/// The server's error: always `{ error, code?, fieldErrors?, matches? }`.
class ApiException implements Exception {
  ApiException(this.message, {this.status = 0, this.fieldErrors = const {}, this.code, this.data});
  final String message;
  final int status;
  final Map<String, String> fieldErrors;
  final String? code;
  final Json? data;

  bool get unauthorized => status == 401;
  bool get forbidden => status == 403;

  /// 409 with code "duplicate": a customer with the same email or phone exists.
  bool get duplicate => code == 'duplicate';

  /// The records it matched: `[{ id, label, detail }]`.
  List<Json> get matches => data?.l('matches') ?? const [];

  /// 409 with code "confirm": an order move with warnings (no deposit, money still due).
  /// The message is the warnings; send the move again with `confirm: true` to go ahead.
  bool get needsConfirm => code == 'confirm';

  String? field(String name) => fieldErrors[name];

  @override
  String toString() => message;
}

/// A PDF from the server, with the name it gave (Content-Disposition) when it gave one.
class PdfFile {
  const PdfFile(this.bytes, {this.fileName});
  final Uint8List bytes;
  final String? fileName;
}

/// Talks to the Kebo API (`<server>/api/...`) with the bearer token.
class Api {
  Api({required String baseUrl, this.onSignedOut, Dio? dio}) : _dio = dio ?? Dio() {
    this.baseUrl = baseUrl;
    _dio.options
      ..connectTimeout = const Duration(seconds: 15)
      ..receiveTimeout = const Duration(seconds: 60)
      ..headers['Accept'] = 'application/json';
    _dio.interceptors.add(InterceptorsWrapper(onRequest: (o, h) {
      if (token != null) o.headers['Authorization'] = 'Bearer $token';
      h.next(o);
    }));
  }

  final Dio _dio;
  String? token;
  void Function()? onSignedOut;

  String get baseUrl => _dio.options.baseUrl;

  /// The server's address. Every path starts with `/api/`, so a trailing `/api` typed by someone is dropped.
  set baseUrl(String v) => _dio.options.baseUrl = normalizeServer(v);

  static String normalizeServer(String v) => v.trim().replaceAll(RegExp(r'/+$'), '').replaceAll(RegExp(r'/api$'), '');

  Future<Json> get(String path, {Map<String, dynamic>? query}) async => _asMap(await _send(() => _dio.get(path, queryParameters: _clean(query))));

  /// Endpoints that answer with a plain list (orders, to-do, people).
  Future<List<Json>> getList(String path, {Map<String, dynamic>? query}) async => _asList(await _send(() => _dio.get(path, queryParameters: _clean(query))));

  Future<Json> post(String path, [Object? body]) async => _asMap(await _send(() => _dio.post(path, data: body ?? const {})));
  Future<Json> patch(String path, Object body) async => _asMap(await _send(() => _dio.patch(path, data: body)));
  Future<Json> put(String path, Object body) async => _asMap(await _send(() => _dio.put(path, data: body)));
  Future<Json> delete(String path, [Object? body]) async => _asMap(await _send(() => _dio.delete(path, data: body)));

  static Map<String, dynamic>? _clean(Map<String, dynamic>? q) {
    if (q == null) return null;
    return {
      for (final e in q.entries)
        if (e.value != null && e.value.toString().isNotEmpty) e.key: e.value
    };
  }

  static Json _asMap(dynamic data) => data is Map ? data.cast<String, dynamic>() : <String, dynamic>{};
  static List<Json> _asList(dynamic data) => data is List ? data.whereType<Map>().map((e) => e.cast<String, dynamic>()).toList() : const [];

  /// Upload one file to a deal (multipart field "file", one file per request).
  Future<Json> uploadFile(String dealId, {required String name, required String path, void Function(double)? onProgress}) async {
    final form = FormData()..files.add(MapEntry('file', await MultipartFile.fromFile(path, filename: name)));
    return _asMap(await _send(() => _dio.post('/api/inquiries/$dealId/files', data: form, onSendProgress: (a, b) => onProgress?.call(b > 0 ? a / b : 0))));
  }

  /// A file as bytes (for the in-app viewer, saving and sharing).
  Future<Uint8List> getBytes(String path, {void Function(double)? onProgress}) async {
    try {
      final res = await _dio.get<List<int>>(
        path,
        options: Options(responseType: ResponseType.bytes, receiveTimeout: const Duration(minutes: 3)),
        onReceiveProgress: (a, b) => onProgress?.call(b > 0 ? a / b : 0),
      );
      return Uint8List.fromList(res.data ?? const []);
    } on DioException catch (e) {
      throw _error(e);
    }
  }

  /// A PDF made by the web app at `<server>/pdf/<kind>/<id>`, sent with this app's session as
  /// `Authorization: Bearer`. Refusals become friendly messages; a 401 here never signs the person
  /// out (the PDF server may simply not accept the app's session yet).
  Future<PdfFile> getPdf(String path, {void Function(double)? onProgress}) async {
    final Response<List<int>> res;
    try {
      res = await _dio.get<List<int>>(
        path,
        options: Options(
          responseType: ResponseType.bytes,
          receiveTimeout: const Duration(minutes: 2),
          headers: {'Accept': 'application/pdf'},
          validateStatus: (_) => true,
        ),
        onReceiveProgress: (a, b) => onProgress?.call(b > 0 ? a / b : 0),
      );
    } on DioException catch (e) {
      throw _error(e);
    }
    final bytes = Uint8List.fromList(res.data ?? const []);
    final status = res.statusCode ?? 0;
    if (status != 200) throw pdfError(status, bytes);
    if (!isPdf(bytes)) {
      throw ApiException('The server answered, but not with a PDF. It may be older than the app: open the document on the web.', status: status);
    }
    return PdfFile(bytes, fileName: fileNameFrom(res.headers.value('content-disposition')));
  }

  /// A real PDF starts with `%PDF-`.
  static bool isPdf(List<int> bytes) => bytes.length >= 5 && String.fromCharCodes(bytes.take(5)) == '%PDF-';

  /// The PDF route answers in plain text; turn its refusals into words for the phone.
  static ApiException pdfError(int status, List<int> body) {
    var said = utf8.decode(body, allowMalformed: true).trim();
    if (said.length > 300 || said.startsWith('<')) said = '';
    final message = switch (status) {
      401 => 'The server did not accept your sign-in for this PDF. Sign out and in again; if it keeps happening, this server cannot send PDFs to the app yet, so open it on the web.',
      403 => 'You may not see this document.',
      404 => 'This document was not found. The server may not make this kind of PDF yet.',
      503 => said.isNotEmpty ? said : 'The server cannot make PDFs right now. Try again in a minute.',
      _ => said.isNotEmpty ? 'The PDF could not be made: ${said.replaceFirst(RegExp(r'\.$'), '')}.' : 'The PDF could not be made ($status).',
    };
    return ApiException(message, status: status);
  }

  /// `attachment; filename="Quotation Q-1-R2.pdf"; filename*=UTF-8''Quotation%20Q-1-R2.pdf` → the name.
  static String? fileNameFrom(String? disposition) {
    if (disposition == null) return null;
    final star = RegExp(r"filename\*=UTF-8''([^;]+)", caseSensitive: false).firstMatch(disposition);
    if (star != null) {
      try {
        return Uri.decodeComponent(star.group(1)!.trim());
      } catch (_) {}
    }
    final plain = RegExp(r'filename="?([^";]+)"?', caseSensitive: false).firstMatch(disposition);
    return plain?.group(1)?.trim();
  }

  /// Download a file to the app's documents folder; returns its path.
  Future<String> download(String path, String fileName) async {
    final dir = await getApplicationDocumentsDirectory();
    final safe = fileName.replaceAll(RegExp(r'[^\w.\- ]+'), '_');
    final target = '${dir.path}/$safe';
    try {
      await _dio.download(path, target, options: Options(receiveTimeout: const Duration(minutes: 2)));
    } on DioException catch (e) {
      throw _error(e);
    }
    return target;
  }

  Future<dynamic> _send(Future<Response<dynamic>> Function() request) async {
    try {
      final res = await request();
      return res.data;
    } on DioException catch (e) {
      throw _error(e);
    }
  }

  ApiException _error(DioException e) {
    final res = e.response;
    if (res == null) {
      debugPrint('[api] ${e.type} ${e.message}');
      return ApiException(
        e.type == DioExceptionType.connectionTimeout || e.type == DioExceptionType.receiveTimeout
            ? 'The server is taking too long to answer. Check your connection and try again.'
            : 'Can\'t reach the server. Check your internet connection.',
      );
    }
    final err = errorFromBody(res.statusCode ?? 0, res.data);
    if (err.unauthorized && token != null && !res.requestOptions.path.contains('/auth/')) onSignedOut?.call();
    return err;
  }

  /// `{ error, code?, fieldErrors?, matches? }` → [ApiException]. fieldErrors are `{ field: [messages] }`.
  static ApiException errorFromBody(int status, Object? data) {
    final body = data is Map ? data.cast<String, dynamic>() : <String, dynamic>{};
    final fields = <String, String>{};
    final fe = body['fieldErrors'];
    if (fe is Map) {
      fe.forEach((k, v) {
        if (v is List && v.isNotEmpty) {
          fields[k.toString()] = v.first.toString();
        } else if (v is String && v.isNotEmpty) {
          fields[k.toString()] = v;
        }
      });
    }
    return ApiException(
      body.s('error', status == 404 ? 'Not found.' : 'Something went wrong ($status).'),
      status: status,
      fieldErrors: fields,
      code: body.sn('code'),
      data: body,
    );
  }
}
