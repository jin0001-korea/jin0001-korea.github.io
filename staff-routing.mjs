/** Decisions use the validated server profile, never a role selected in the browser. */
export function staffDestination(profile, {forcePassword = false, bookingIntent = false} = {}) {
  if (!profile?.active || !['admin', 'instructor', 'counselor'].includes(profile.role)) return 'denied';
  if (forcePassword || profile.must_change_password) return 'password';
  if (profile.role === 'counselor' || profile.role === 'admin' && bookingIntent) return 'booking';
  return 'workspace';
}

export function requestedBooking(search = '') {
  return new URLSearchParams(search).get('next') === 'booking';
}

export function bookingWorkspaceUrl(href, view = 'reservations') {
  return new URL(`/booking/#${['changes', 'calls', 'payments'].includes(view) ? view : 'reservations'}`, href).href;
}

export function staffMenu(role) {
  if (!['admin', 'instructor'].includes(role)) return [];
  const admin = role === 'admin';
  return [
    ['dashboard', 'grid', admin ? '운영 현황' : '나의 홈'],
    ...(admin ? [['bookings', 'calendar', '예약 · 강사 배정'], ['changes', 'clock', '고객 일정 요청'], ['calls', 'users', '상담 · 전화'], ['payments', 'report', '입금 검토'], ['friend-matches', 'users', '친구 매칭']] : []),
    ['overview', 'sheet', '통합 현황표'],
    ['schedules', 'calendar', '강습 일정'],
    ['reports', 'report', '보고서 관리'],
    ['alerts', 'bell', '확인 · 알림'],
    ['scores', 'star', '점수 · 리오더'],
    ['timeoff', 'calendar', admin ? '휴무 관리' : '휴무 신청'],
    ...(admin ? [['cash-receipts','report','현금영수증 관리'], ['instructors', 'users', '계정 · 권한 관리'], ['settings', 'settings', '운영 설정'], ['guide','help','기능 · 업무 안내']] : []),
  ];
}

/** Group only links already permitted for the validated role. Home remains a direct link. */
export function staffMenuGroups(role, currentPage = '') {
  const menu = new Map(staffMenu(role).map(item => [item[0], item]));
  return [
    ['booking', '예약 · 고객', 'calendar', ['bookings', 'changes', 'calls', 'payments', 'friend-matches']],
    ['lessons', role === 'admin' ? '강습 운영' : '나의 강습', 'report', ['schedules', 'reports', 'timeoff']],
    ['insights', '확인 · 성과', 'sheet', ['alerts', 'overview', 'scores']],
    ['management', '운영 관리', 'settings', ['cash-receipts', 'instructors', 'settings', 'guide']],
  ].map(([id, label, icon, pages]) => {
    const items = pages.map(page => menu.get(page)).filter(Boolean);
    return {id, label, icon, items, active: items.some(([page]) => page === currentPage)};
  }).filter(group => group.items.length);
}

export const staffRoleLabel = role => ({admin:'관리자', instructor:'강사', counselor:'상담사'}[role] || '사용자');
export const canUseAdminGuide = profile => profile?.role==='admin'&&profile.active===true&&profile.must_change_password===false;
