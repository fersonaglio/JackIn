'use client';
import { Suspense } from 'react';
import CatalogPage from '@/components/media/CatalogPage';

export default function SeriesPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center min-h-screen">
          <div className="w-6 h-6 border-2 border-[#EF9F27] border-t-transparent rounded-full animate-spin" />
        </div>
      }
    >
      <CatalogPage type="tv" />
    </Suspense>
  );
}
