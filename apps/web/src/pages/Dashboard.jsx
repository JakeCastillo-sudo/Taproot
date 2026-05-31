import React from 'react';
import { TrendingUp, ShoppingBag, DollarSign, Calendar } from 'lucide-react';
import { useFetch } from '../hooks/useApi';
import { useApp } from '../context/AppContext';

function StatCard({ label, value, sub, icon: Icon, color }) {
  return (
    <div className="card p-5">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs text-gray-500 font-medium uppercase tracking-wide">{label}</p>
          <p className="text-2xl font-bold mt-1">{value}</p>
          {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
        </div>
        <div className={`p-2.5 rounded-xl ${color}`}>
          <Icon size={20} className="text-white" />
        </div>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const { data, loading } = useFetch('/api/orders/summary');
  const { settings } = useApp();
  const sym = settings.currency_symbol || '$';

  if (loading) return (
    <div className="p-8 text-center text-gray-400 animate-pulse">Loading dashboard...</div>
  );

  const fmt = (n) => `${sym}${Number(n || 0).toFixed(2)}`;

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-xl font-bold">Dashboard</h1>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Today's Sales" value={fmt(data?.today?.revenue)} sub={`${data?.today?.count || 0} orders`} icon={DollarSign} color="bg-green-500" />
        <StatCard label="This Week" value={fmt(data?.week?.revenue)} sub={`${data?.week?.count || 0} orders`} icon={TrendingUp} color="bg-blue-500" />
        <StatCard label="This Month" value={fmt(data?.month?.revenue)} sub={`${data?.month?.count || 0} orders`} icon={Calendar} color="bg-purple-500" />
        <StatCard label="Avg Order" value={fmt((data?.month?.revenue || 0) / Math.max(data?.month?.count || 1, 1))} sub="this month" icon={ShoppingBag} color="bg-orange-500" />
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        {/* Top products */}
        <div className="card p-5">
          <h2 className="font-semibold text-sm mb-4">Top Products (30 days)</h2>
          {(data?.topProducts || []).length === 0 ? (
            <p className="text-gray-400 text-sm text-center py-6">No sales yet</p>
          ) : (
            <div className="space-y-3">
              {(data?.topProducts || []).map((p, i) => (
                <div key={p.product_name} className="flex items-center gap-3">
                  <span className="text-xs text-gray-400 w-4">{i + 1}</span>
                  <div className="flex-1">
                    <p className="text-sm font-medium">{p.product_name}</p>
                    <div className="w-full bg-gray-100 rounded-full h-1.5 mt-1">
                      <div
                        className="bg-green-500 h-1.5 rounded-full"
                        style={{ width: `${(p.qty / (data.topProducts[0]?.qty || 1)) * 100}%` }}
                      />
                    </div>
                  </div>
                  <span className="text-xs text-gray-500">{p.qty} sold</span>
                  <span className="text-xs font-semibold text-green-600">{fmt(p.revenue)}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Recent orders */}
        <div className="card p-5">
          <h2 className="font-semibold text-sm mb-4">Recent Orders</h2>
          {(data?.recentOrders || []).length === 0 ? (
            <p className="text-gray-400 text-sm text-center py-6">No orders yet</p>
          ) : (
            <div className="space-y-2">
              {(data?.recentOrders || []).map(o => (
                <div key={o.id} className="flex items-center justify-between py-2 border-b last:border-0">
                  <div>
                    <p className="text-xs font-mono text-gray-700">{o.order_number}</p>
                    <p className="text-xs text-gray-400">{new Date(o.created_at).toLocaleString()}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold">{fmt(o.total)}</p>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${
                      o.status === 'completed' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'
                    }`}>{o.status}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
