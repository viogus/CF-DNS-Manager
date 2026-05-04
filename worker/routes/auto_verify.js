/**
 * 自动验证配置端点
 * 将 Cloudflare 自定义主机名的验证记录自动添加到 DNSPod
 * 支持自动从主机名提取并匹配 DNSPod 域名
 */

import { callDnspodApi } from './_tc3';

/**
 * 从主机名中提取可能的域名列表
 * 例如 "app.shop.customer.com" -> ["shop.customer.com", "customer.com"]
 */
function extractPossibleDomains(hostname) {
  const parts = hostname.split('.');
  const domains = [];
  for (let i = 1; i < parts.length - 1; i++) {
    domains.push(parts.slice(i).join('.'));
  }
  return domains;
}

/**
 * POST /api/zones/[zoneId]/auto_verify
 * 自动配置验证记录到 DNSPod
 */
export async function POST(request, env, params, data) {
  const { dnspodSecretId, dnspodSecretKey } = data;

  if (!dnspodSecretId || !dnspodSecretKey) {
    return new Response(JSON.stringify({
      success: false,
      error: 'DNSPod credentials not configured'
    }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    const body = await request.json();
    const { hostname, txt_name, txt_value, record_type = 'TXT' } = body;

    if (!hostname || !txt_name || !txt_value) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Missing required parameters: hostname, txt_name, txt_value'
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const domainListResult = await callDnspodApi(dnspodSecretId, dnspodSecretKey, 'DescribeDomainList', {});

    if (domainListResult.Response?.Error) {
      return new Response(JSON.stringify({
        success: false,
        error: `DNSPod API error: ${domainListResult.Response.Error.Message}`
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const dnspodDomains = domainListResult.Response?.DomainList || [];
    const dnspodDomainNames = dnspodDomains.map(d => d.Name.toLowerCase());

    const possibleDomains = extractPossibleDomains(hostname.toLowerCase());
    let matchedDomain = null;

    for (const domain of possibleDomains) {
      if (dnspodDomainNames.includes(domain)) {
        matchedDomain = domain;
        break;
      }
    }

    if (!matchedDomain) {
      return new Response(JSON.stringify({
        success: false,
        error: `No matching domain found in DNSPod for hostname: ${hostname}. Tried: ${possibleDomains.join(', ')}`
      }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    let subDomain = txt_name;
    if (txt_name.toLowerCase().endsWith('.' + matchedDomain)) {
      subDomain = txt_name.slice(0, -(matchedDomain.length + 1));
    } else if (txt_name.toLowerCase().endsWith(matchedDomain)) {
      subDomain = txt_name.slice(0, -matchedDomain.length);
      if (subDomain.endsWith('.')) {
        subDomain = subDomain.slice(0, -1);
      }
    }

    if (!subDomain) {
      subDomain = '@';
    }

    const listResult = await callDnspodApi(dnspodSecretId, dnspodSecretKey, 'DescribeRecordList', {
      Domain: matchedDomain,
      Subdomain: subDomain,
      RecordType: record_type
    });

    if (listResult.Response?.RecordList?.length > 0) {
      for (const oldRecord of listResult.Response.RecordList) {
        if (oldRecord.Value === txt_value) {
          return new Response(JSON.stringify({
            success: true,
            message: 'Record already exists with same value',
            record_id: oldRecord.RecordId,
            domain: matchedDomain,
            sub_domain: subDomain
          }), {
            headers: { 'Content-Type': 'application/json' }
          });
        }

        await callDnspodApi(dnspodSecretId, dnspodSecretKey, 'DeleteRecord', {
          Domain: matchedDomain,
          RecordId: oldRecord.RecordId
        });
      }
    }

    const createResult = await callDnspodApi(dnspodSecretId, dnspodSecretKey, 'CreateRecord', {
      Domain: matchedDomain,
      SubDomain: subDomain,
      RecordType: record_type,
      RecordLine: '默认',
      Value: txt_value,
      TTL: 600
    });

    if (createResult.Response?.Error) {
      return new Response(JSON.stringify({
        success: false,
        error: createResult.Response.Error.Message,
        code: createResult.Response.Error.Code
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    return new Response(JSON.stringify({
      success: true,
      message: 'Record created successfully',
      record_id: createResult.Response?.RecordId,
      domain: matchedDomain,
      sub_domain: subDomain,
      record_type,
      value: txt_value
    }), {
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
