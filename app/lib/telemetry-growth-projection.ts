export function project30dRows(last7dRows: number, last24hRows: number) {
  const weeklyDailyAverage = Math.max(0, last7dRows) / 7;
  const recentDailyRate = Math.max(0, last24hRows);
  const dailyRate = Math.max(weeklyDailyAverage, recentDailyRate);
  return Math.round(dailyRate * 30);
}
