/**
 * DNSPod API 代理
 * 支持腾讯云 DNS API v3，使用 TC3-HMAC-SHA256 签名
 */

import { callDnspodApi } from './_tc3';

// GET: 检查 DNSPod 是否配置
export async function GET(request, env, params, data) {
  const { dnspodSecretId, dnspodSecretKey } = data;

  return new Response(JSON.stringify({
    configured: !!(dnspodSecretId && dnspodSecretKey)
  }), {
    headers: { 'Content-Type': 'application/json' }
  });
}

// POST: 代理 DNSPod API 请求
export async function POST(request, env, params, data) {
  const { dnspodSecretId, dnspodSecretKey } = data;

  if (!dnspodSecretId || !dnspodSecretKey) {
    return new Response(JSON.stringify({
      success: false,
      error: 'DNSPod credentials not configured. Please set DNSPOD_SECRET_ID and DNSPOD_SECRET_KEY environment variables.'
    }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    const body = await request.json();
    const { action, ...payload } = body;

    if (!action) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Missing action parameter'
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // 限制可调用的 Actions（安全考虑）
    const allowedActions = [
      'DescribeDomainList',
      'DescribeRecordList',
      'CreateRecord',
      'ModifyRecord',
      'DeleteRecord'
    ];

    if (!allowedActions.includes(action)) {
      return new Response(JSON.stringify({
        success: false,
        error: `Action '${action}' is not allowed`
      }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const result = await callDnspodApi(dnspodSecretId, dnspodSecretKey, action, payload);

    return new Response(JSON.stringify({
      success: !result.Response?.Error,
      ...result
    }), {
      status: result.Response?.Error ? 400 : 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error.message || 'Internal server error'
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
