export interface DirectoryDisplay {
	readonly snapshotId: string;
	readonly site: DisplaySite;
	readonly appearance: DisplayAppearance;
	readonly grouped: boolean;
	readonly groups: readonly DisplayGroup[];
}

export interface DisplaySite {
	readonly title: string;
	readonly description: string;
	readonly footer: string;
	readonly logo_path: string;
	readonly favicon_path: string;
}

export interface DisplayAppearance {
	readonly primary_light_color: string;
	readonly primary_dark_color: string;
}

export interface DisplayGroup {
	readonly id: string;
	readonly label?: string;
	readonly links: readonly DisplayLink[];
}

export interface DisplayLink {
	readonly id: string;
	readonly logo_path: string;
	readonly title: string;
	readonly url: string;
	readonly description?: string;
	readonly favicon_path?: string;
	readonly tags: readonly string[];
	readonly requires_auth: boolean;
	readonly internal_only: boolean;
	readonly admin_only: boolean;
}
