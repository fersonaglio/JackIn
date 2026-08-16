'use client';
import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import SearchResultsPage from '@/components/media/SearchResultsPage';

function SearchResultsLoader() {
  const params = useSearchParams();
  const query = params.get('q') || '';
  return <SearchResultsPage query={query} />;
}

export default function SearchPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center min-h-screen">
          <div className="w-6 h-6 border-2 border-[#EF9F27] border-t-transparent rounded-full animate-spin" />
        </div>
      }
    >
      <SearchResultsLoader />
    </Suspense>
  );
}
