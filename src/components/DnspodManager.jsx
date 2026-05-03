import { useState, useEffect } from 'react';
import { Server, RefreshCw, Plus, Edit2, Trash2, Search, ArrowLeft } from 'lucide-react';
import CustomSelect from './CustomSelect.jsx';
import { getAuthHeaders } from '../utils.js';

const DnspodManager = ({ auth, onBack, t, showToast }) => {
    const [domains, setDomains] = useState([]);
    const [selectedDomain, setSelectedDomain] = useState(null);
    const [records, setRecords] = useState([]);
    const [loading, setLoading] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const [showModal, setShowModal] = useState(false);
    const [editingRecord, setEditingRecord] = useState(null);
    const [confirmModal, setConfirmModal] = useState({ show: false, title: '', message: '', onConfirm: null });
    const [newRecord, setNewRecord] = useState({
        SubDomain: '',
        RecordType: 'A',
        RecordLine: '默认',
        Value: '',
        TTL: 600,
        MX: 10
    });

    const openConfirm = (title, message, onConfirm) => {
        setConfirmModal({ show: true, title, message, onConfirm });
    };

    const getHeaders = (withType = false) => getAuthHeaders(auth, withType);

    // Fetch DNSPod domains
    const fetchDomains = async () => {
        setLoading(true);
        try {
            const res = await fetch('/api/dnspod', {
                method: 'POST',
                headers: getHeaders(true),
                body: JSON.stringify({ action: 'DescribeDomainList' })
            });
            const data = await res.json();
            if (data.Response?.DomainList) {
                setDomains(data.Response.DomainList);
                if (data.Response.DomainList.length > 0 && !selectedDomain) {
                    setSelectedDomain(data.Response.DomainList[0]);
                }
            }
        } catch (e) {
            showToast(t('errorOccurred'), 'error');
        }
        setLoading(false);
    };

    // Fetch records for selected domain
    const fetchRecords = async () => {
        if (!selectedDomain) return;
        setLoading(true);
        try {
            const res = await fetch('/api/dnspod', {
                method: 'POST',
                headers: getHeaders(true),
                body: JSON.stringify({
                    action: 'DescribeRecordList',
                    Domain: selectedDomain.Name
                })
            });
            const data = await res.json();
            setRecords(data.Response?.RecordList || []);
        } catch (e) {
            showToast(t('errorOccurred'), 'error');
        }
        setLoading(false);
    };

    useEffect(() => {
        fetchDomains();
    }, []);

    useEffect(() => {
        if (selectedDomain) {
            fetchRecords();
        }
    }, [selectedDomain]);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);
        try {
            const payload = {
                action: editingRecord ? 'ModifyRecord' : 'CreateRecord',
                Domain: selectedDomain.Name,
                SubDomain: newRecord.SubDomain || '@',
                RecordType: newRecord.RecordType,
                RecordLine: newRecord.RecordLine,
                Value: newRecord.Value,
                TTL: parseInt(newRecord.TTL) || 600
            };
            if (newRecord.RecordType === 'MX') {
                payload.MX = parseInt(newRecord.MX) || 10;
            }
            if (editingRecord) {
                payload.RecordId = editingRecord.RecordId;
            }

            const res = await fetch('/api/dnspod', {
                method: 'POST',
                headers: getHeaders(true),
                body: JSON.stringify(payload)
            });
            const data = await res.json();
            if (data.success) {
                showToast(editingRecord ? t('updateSuccess') : t('addSuccess'));
                setShowModal(false);
                setEditingRecord(null);
                setNewRecord({ SubDomain: '', RecordType: 'A', RecordLine: '默认', Value: '', TTL: 600, MX: 10 });
                fetchRecords();
            } else {
                showToast(data.Response?.Error?.Message || t('errorOccurred'), 'error');
            }
        } catch (e) {
            showToast(t('errorOccurred'), 'error');
        }
        setLoading(false);
    };

    const deleteRecord = async (recordId) => {
        openConfirm(t('confirmTitle'), t('confirmDeleteRecord'), async () => {
            try {
                const res = await fetch('/api/dnspod', {
                    method: 'POST',
                    headers: getHeaders(true),
                    body: JSON.stringify({
                        action: 'DeleteRecord',
                        Domain: selectedDomain.Name,
                        RecordId: recordId
                    })
                });
                const data = await res.json();
                if (data.success) {
                    showToast(t('deleteSuccess'));
                    fetchRecords();
                } else {
                    showToast(data.Response?.Error?.Message || t('errorOccurred'), 'error');
                }
            } catch (e) {
                showToast(t('errorOccurred'), 'error');
            }
        });
    };

    const startEdit = (record) => {
        setEditingRecord(record);
        setNewRecord({
            SubDomain: record.Name,
            RecordType: record.Type,
            RecordLine: record.Line,
            Value: record.Value,
            TTL: record.TTL,
            MX: record.MX || 10
        });
        setShowModal(true);
    };

    const filteredRecords = records.filter(r =>
        r.Name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        r.Value?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        r.Type?.toLowerCase().includes(searchTerm.toLowerCase())
    );

    return (
        <div className="container">
            {/* Header - same style as ZoneDetail */}
            <div style={{ marginBottom: '0.5rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <div style={{ padding: '0.25rem', background: '#e0f2fe', borderRadius: '8px' }}>
                        <Server size={24} color="#0284c7" />
                    </div>
                    <h1 style={{ fontSize: '1.5rem', margin: 0, lineHeight: 1 }}>{t('dnspodManager')}</h1>
                    <button className="btn btn-outline" onClick={onBack} style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <ArrowLeft size={16} />
                        {t('backToCloudflare')}
                    </button>
                </div>
            </div>

            {/* Domain selector - similar to Zone selector */}
            <div className="glass-card" style={{ padding: '1rem', marginBottom: '1.5rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
                    <label style={{ fontWeight: 600, fontSize: '0.875rem', color: 'var(--text-muted)' }}>{t('selectDomain')}:</label>
                    <div style={{ flex: 1, minWidth: '200px', maxWidth: '300px' }}>
                        <CustomSelect
                            value={selectedDomain?.Name || ''}
                            onChange={(e) => {
                                const domain = domains.find(d => d.Name === e.target.value);
                                setSelectedDomain(domain);
                            }}
                            options={domains.map(d => ({ value: d.Name, label: d.Name }))}
                        />
                    </div>
                    <div style={{ display: 'flex', gap: '0.5rem', marginLeft: 'auto' }}>
                        <button className="btn btn-outline" onClick={() => fetchDomains()} disabled={loading}>
                            <RefreshCw size={16} className={loading ? 'spin' : ''} />
                            {t('refresh')}
                        </button>
                        <button className="btn btn-primary" onClick={() => { setEditingRecord(null); setNewRecord({ SubDomain: '', RecordType: 'A', RecordLine: '默认', Value: '', TTL: 600, MX: 10 }); setShowModal(true); }}>
                            <Plus size={16} />
                            {t('addDnspodRecord')}
                        </button>
                    </div>
                </div>
            </div>

            {/* Main content card - same as ZoneDetail */}
            <div className="glass-card" style={{ padding: '1.25rem', overflow: 'hidden' }}>
                <div className="flex-stack header-stack" style={{ marginBottom: '1.0rem', flexWrap: 'wrap', gap: '1rem' }}>
                    <div className="header-top-row" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                        <h2 style={{ margin: 0, whiteSpace: 'nowrap' }}>{t('dnsRecords')}</h2>
                        <div style={{ position: 'relative', width: '100%', maxWidth: '300px' }}>
                            <Search size={16} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                            <input
                                type="text"
                                placeholder={t('searchPlaceholder')}
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                style={{ paddingLeft: '36px', width: '100%' }}
                            />
                        </div>
                    </div>
                </div>

                {/* Records Table */}
                {loading && records.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>
                        <RefreshCw className="spin" size={32} />
                        <p style={{ marginTop: '1rem' }}>{t('statusInitializing')}</p>
                    </div>
                ) : filteredRecords.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>
                        <p>{t('noRecordsFound')}</p>
                    </div>
                ) : (
                    <>
                        <div className="table-container">
                            <table className="data-table desktop-only">
                                <thead>
                                    <tr>
                                        <th>{t('type')}</th>
                                        <th>{t('subDomain')}</th>
                                        <th>{t('recordValue')}</th>
                                        <th>{t('recordLine')}</th>
                                        <th>TTL</th>
                                        <th>{t('actions')}</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {filteredRecords.map(r => (
                                        <tr key={r.RecordId}>
                                            <td><span className="badge badge-blue">{r.Type}</span></td>
                                            <td style={{ fontWeight: 600 }}>{r.Name || '@'}</td>
                                            <td className="truncate-mobile" style={{ color: 'var(--text-muted)', fontSize: '0.8125rem' }}>{r.Value}</td>
                                            <td style={{ fontSize: '0.8125rem' }}>{r.Line}</td>
                                            <td style={{ fontSize: '0.8125rem' }}>{r.TTL}</td>
                                            <td>
                                                <div style={{ display: 'flex', gap: '4px' }}>
                                                    <button className="btn btn-outline" style={{ padding: '0.4rem', border: 'none' }} onClick={() => startEdit(r)}>
                                                        <Edit2 size={16} color="var(--primary)" />
                                                    </button>
                                                    <button className="btn btn-outline" style={{ padding: '0.4rem', border: 'none' }} onClick={() => deleteRecord(r.RecordId)}>
                                                        <Trash2 size={16} color="var(--error)" />
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>

                        {/* Mobile Cards */}
                        <div className="mobile-only">
                            {filteredRecords.map(r => (
                                <div key={r.RecordId} className="record-card" style={{ padding: '0.875rem', marginBottom: '8px' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                                        <div>
                                            <span className="badge badge-blue" style={{ marginRight: '8px' }}>{r.Type}</span>
                                            <span style={{ fontWeight: 600 }}>{r.Name || '@'}</span>
                                        </div>
                                        <div style={{ display: 'flex', gap: '4px' }}>
                                            <button className="btn btn-outline" style={{ padding: '0.35rem', border: 'none' }} onClick={() => startEdit(r)}>
                                                <Edit2 size={15} color="var(--primary)" />
                                            </button>
                                            <button className="btn btn-outline" style={{ padding: '0.35rem', border: 'none' }} onClick={() => deleteRecord(r.RecordId)}>
                                                <Trash2 size={15} color="var(--error)" />
                                            </button>
                                        </div>
                                    </div>
                                    <div style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', wordBreak: 'break-all' }}>{r.Value}</div>
                                </div>
                            ))}
                        </div>
                    </>
                )}

                {/* Add/Edit Modal */}
                {showModal && (
                    <div
                        style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(4px)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000 }}
                        onClick={(e) => { if (e.target === e.currentTarget) setShowModal(false); }}
                    >
                        <div className="glass-card fade-in" style={{ padding: '2rem', maxWidth: '450px', width: '90%' }}>
                            <h2 style={{ marginBottom: '1.5rem' }}>{editingRecord ? t('editDnspodRecord') : t('addDnspodRecord')}</h2>
                            <form onSubmit={handleSubmit}>
                                <div className="input-row">
                                    <label>{t('type')}</label>
                                    <div style={{ flex: 1 }}>
                                        <CustomSelect
                                            value={newRecord.RecordType}
                                            onChange={(e) => setNewRecord({ ...newRecord, RecordType: e.target.value })}
                                            options={['A', 'AAAA', 'CNAME', 'MX', 'TXT', 'NS', 'SRV', 'CAA'].map(t => ({ value: t, label: t }))}
                                        />
                                    </div>
                                </div>
                                <div className="input-row">
                                    <label>{t('subDomain')}</label>
                                    <input
                                        type="text"
                                        value={newRecord.SubDomain}
                                        onChange={(e) => setNewRecord({ ...newRecord, SubDomain: e.target.value })}
                                        placeholder="@"
                                    />
                                </div>
                                <div className="input-row">
                                    <label>{t('recordValue')}</label>
                                    <input
                                        type="text"
                                        value={newRecord.Value}
                                        onChange={(e) => setNewRecord({ ...newRecord, Value: e.target.value })}
                                        required
                                    />
                                </div>
                                <div className="input-row">
                                    <label>{t('recordLine')}</label>
                                    <div style={{ flex: 1 }}>
                                        <CustomSelect
                                            value={newRecord.RecordLine}
                                            onChange={(e) => setNewRecord({ ...newRecord, RecordLine: e.target.value })}
                                            options={[
                                                { value: '默认', label: t('lineDefault') },
                                                { value: '电信', label: '电信' },
                                                { value: '联通', label: '联通' },
                                                { value: '移动', label: '移动' },
                                                { value: '境外', label: '境外' }
                                            ]}
                                        />
                                    </div>
                                </div>
                                {newRecord.RecordType === 'MX' && (
                                    <div className="input-row">
                                        <label>{t('priority')}</label>
                                        <input
                                            type="number"
                                            value={newRecord.MX}
                                            onChange={(e) => setNewRecord({ ...newRecord, MX: parseInt(e.target.value) })}
                                            min="1"
                                            max="100"
                                        />
                                    </div>
                                )}
                                <div className="input-row">
                                    <label>TTL</label>
                                    <div style={{ flex: 1 }}>
                                        <CustomSelect
                                            value={newRecord.TTL.toString()}
                                            onChange={(e) => setNewRecord({ ...newRecord, TTL: parseInt(e.target.value) })}
                                            options={[
                                                { value: '1', label: t('ttlAuto') },
                                                { value: '60', label: '1 ' + t('ttl1m').split(' ')[1] },
                                                { value: '300', label: '5 ' + t('ttl5m').split(' ')[1] },
                                                { value: '600', label: '10 min' },
                                                { value: '3600', label: '1 ' + t('ttl1h').split(' ')[1] }
                                            ]}
                                        />
                                    </div>
                                </div>
                                <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1.5rem' }}>
                                    <button type="button" className="btn btn-outline" style={{ flex: 1 }} onClick={() => { setShowModal(false); setEditingRecord(null); }}>{t('cancel')}</button>
                                    <button type="submit" className="btn btn-primary" style={{ flex: 1 }} disabled={loading}>{t('save')}</button>
                                </div>
                            </form>
                        </div>
                    </div>
                )}

                {/* Confirm Modal */}
                {confirmModal.show && (
                    <div
                        style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(4px)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000 }}
                        onClick={(e) => { if (e.target === e.currentTarget) setConfirmModal({ show: false }); }}
                    >
                        <div className="glass-card fade-in" style={{ padding: '2rem', maxWidth: '400px', width: '90%', textAlign: 'center' }}>
                            <h3 style={{ marginBottom: '1rem' }}>{confirmModal.title}</h3>
                            <p style={{ marginBottom: '1.5rem', color: 'var(--text-muted)' }}>{confirmModal.message}</p>
                            <div style={{ display: 'flex', gap: '0.75rem' }}>
                                <button className="btn btn-outline" style={{ flex: 1 }} onClick={() => setConfirmModal({ show: false })}>{t('cancel')}</button>
                                <button className="btn btn-primary" style={{ flex: 1, background: 'var(--error)' }} onClick={() => { confirmModal.onConfirm?.(); setConfirmModal({ show: false }); }}>{t('yes')}</button>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div >
    );
};

export default DnspodManager;
