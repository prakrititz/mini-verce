import Docker from 'dockerode';
import tar from 'tar-fs';
import path from 'path';

const docker = new Docker();

export async function buildImage(projectPath: string, imageName: string, buildargs?: Record<string, string>): Promise<void> {
  return new Promise((resolve, reject) => {
    console.log(`Packing directory ${projectPath}...`);
    const pack = tar.pack(projectPath);
    
    console.log(`Building Docker image ${imageName}...`);
    const buildOptions: any = { t: imageName };
    if (buildargs && Object.keys(buildargs).length > 0) {
      buildOptions.buildargs = buildargs;
    }
    
    docker.buildImage(pack, buildOptions, (err: any, stream: any) => {
      if (err) return reject(err);
      
      docker.modem.followProgress(
        stream,
        (onFinishedErr, output) => {
          if (onFinishedErr) reject(onFinishedErr);
          else resolve();
        },
        (event) => {
          if (event.stream) {
            process.stdout.write(event.stream);
          }
        }
      );
    });
  });
}

export async function startContainer(imageName: string, port: number, containerName: string, env?: string[], exposedPort: number = 3000): Promise<string> {
  const container = await docker.createContainer({
    Image: imageName,
    name: containerName,
    Env: env || [],
    HostConfig: {
      PortBindings: {
        [`${exposedPort}/tcp`]: [{ HostPort: port.toString() }]
      }
    }
  });

  await container.start();
  return container.id;
}

export async function stopContainer(containerId: string, remove: boolean = true): Promise<void> {
  try {
    const container = docker.getContainer(containerId);
    try {
      await container.stop();
    } catch (err: any) {
      if (err.statusCode !== 304) throw err; // 304 is already stopped
    }
    if (remove) {
      await container.remove();
    }
  } catch (err: any) {
    if (err.statusCode !== 404) {
      console.error(`Failed to stop/remove container ${containerId}:`, err);
    }
  }
}

/**
 * Restart a container: stop it (without removing), then start it again.
 * Returns the container ID (same as before).
 */
export async function restartContainer(containerId: string): Promise<void> {
  try {
    const container = docker.getContainer(containerId);
    await container.restart({ t: 10 }); // 10-second grace period
  } catch (err: any) {
    if (err.statusCode !== 404) {
      console.error(`Failed to restart container ${containerId}:`, err);
      throw err;
    }
  }
}

/**
 * Inspect a container and return its key stats.
 * Returns null if the container doesn't exist.
 */
export async function inspectContainer(containerId: string): Promise<{
  id: string;
  name: string;
  status: string;
  startedAt: string;
  image: string;
} | null> {
  try {
    const container = docker.getContainer(containerId);
    const info = await container.inspect();
    return {
      id: info.Id.slice(0, 12),
      name: info.Name.replace(/^\//, ''),
      status: info.State.Status,
      startedAt: info.State.StartedAt,
      image: info.Config.Image,
    };
  } catch (err: any) {
    if (err.statusCode === 404) return null;
    throw err;
  }
}

export async function printContainerLogs(containerId: string, follow: boolean = false): Promise<void> {
  return new Promise(async (resolve, reject) => {
    try {
      const container = docker.getContainer(containerId);
      const stream = await container.logs({
        stdout: true,
        stderr: true,
        tail: 100,
        follow
      } as any);

      if (follow) {
        docker.modem.demuxStream(stream as any, process.stdout, process.stderr);
        (stream as any).on('end', () => resolve());
        (stream as any).on('error', (err: any) => reject(err));
      } else {
        // When follow is false, stream is usually a Buffer
        process.stdout.write(stream as any);
        resolve();
      }
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Stream container logs via a callback — used for SSE log endpoint.
 * Calls onChunk(text) for each log chunk, onEnd() when stream closes.
 */
export function streamContainerLogs(
  containerId: string,
  onChunk: (text: string) => void,
  onEnd: () => void,
  onError: (err: Error) => void
): void {
  const container = docker.getContainer(containerId);
  container.logs({
    stdout: true,
    stderr: true,
    tail: 80,
    follow: true,
    timestamps: true,
  } as any, (err: any, stream: any) => {
    if (err) { onError(err); return; }
    // demux the multiplexed Docker log stream
    const stdout = new (require('stream').PassThrough)();
    const stderr = new (require('stream').PassThrough)();
    docker.modem.demuxStream(stream, stdout, stderr);

    const handleData = (chunk: Buffer) => onChunk(chunk.toString('utf8'));
    stdout.on('data', handleData);
    stderr.on('data', handleData);
    stream.on('end', onEnd);
    stream.on('error', onError);
  });
}
