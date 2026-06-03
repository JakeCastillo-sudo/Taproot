import React from 'react';
import { Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';
import Register from './pages/Register';
import Dashboard from './pages/Dashboard';
import Products from './pages/Products';
import Orders from './pages/Orders';
import Settings from './pages/Settings';
import { AppProvider } from './context/AppContext';

class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  render() {
    if (this.state.error) return (
      <div className="p-8 text-center">
        <p className="text-red-600 font-semibold">Something went wrong</p>
        <p className="text-sm text-gray-500 mt-1">{this.state.error.message}</p>
        <button onClick={() => this.setState({ error: null })} className="btn-secondary mt-4">Try again</button>
      </div>
    );
    return this.props.children;
  }
}

export default function App() {
  return (
    <AppProvider>
      <Layout>
        <ErrorBoundary>
          <Routes>
            <Route path="/" element={<Register />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/products" element={<Products />} />
            <Route path="/orders" element={<Orders />} />
            <Route path="/settings" element={<Settings />} />
          </Routes>
        </ErrorBoundary>
      </Layout>
    </AppProvider>
  );
}
