import { ArrowUpRight, Play } from 'lucide-react';
import { getLatestDemoVideos } from '@/lib/youtube-videos';

export function LatestDemoLinks({ slug }: { slug: string }) {
  const videos = getLatestDemoVideos(slug);
  if (videos.length === 0) return null;

  return (
    <section className="latest-demo-links wrap" aria-labelledby="latest-demo-title">
      <div>
        <p className="capability-kicker">RECORDED IN THE LATEST APP</p>
        <h2 id="latest-demo-title">최신 앱 시연</h2>
      </div>
      <div className="latest-demo-grid">
        {videos.map((video) => (
          <a
            key={video.key}
            href={video.url}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`${video.title} 시연 영상 보기 (새 탭)`}
          >
            <span>
              <Play size={16} fill="currentColor" aria-hidden="true" />
              <small>{video.key}</small>
              <b>{video.title}</b>
            </span>
            <ArrowUpRight size={18} aria-hidden="true" />
          </a>
        ))}
      </div>
    </section>
  );
}
