// ============================================================
// แบบฟอร์มแจ้งเคลม และสถานะ
// ⚠️ เป็นชุดเริ่มต้น กรุณายืนยันกับทีม Insurance/Claim
// ============================================================
export const CLAIM = {
  initialStatus: 'Submitted',
  statuses: ['Submitted', 'In Review', 'Need More Info', 'Submitted to Insurer', 'Approved', 'Rejected', 'Closed'],

  // type = text | textarea | date | number | tel
  form: [
    { name: 'policy', label: 'กรมธรรม์ / เลขที่กรมธรรม์', type: 'text', max: 100, required: true },
    { name: 'incidentDate', label: 'วันที่เกิดเหตุ', type: 'date', required: true },
    { name: 'incidentLocation', label: 'สถานที่เกิดเหตุ', type: 'text', max: 255, required: true },
    { name: 'detail', label: 'รายละเอียดเหตุการณ์และความเสียหาย', type: 'textarea', max: 4000, required: true },
    { name: 'amount', label: 'มูลค่าความเสียหายโดยประมาณ (บาท)', type: 'number', required: false },
    { name: 'contactName', label: 'ชื่อผู้ติดต่อ', type: 'text', max: 100, required: true },
    { name: 'contactPhone', label: 'เบอร์โทรผู้ติดต่อ', type: 'tel', max: 30, required: true },
  ],
};
