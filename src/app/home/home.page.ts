import { Component, computed, signal, OnDestroy, inject,} from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { Subscription, timeout } from 'rxjs';
import { Haptics, ImpactStyle } from '@capacitor/haptics';
import * as L from 'leaflet';
import { campusPlaces, type CampusPlace } from './campus-places';
import { Capacitor } from '@capacitor/core';
import { Geolocation, type Position } from '@capacitor/geolocation';
import {
  gpsToMap,
  gpsAccuracyOutline,
} from './campus-map-coordinates';

import {
  IonHeader,
  IonToolbar,
  IonTitle,
  IonContent,
  IonSearchbar,
  IonInput,
  IonSelect,
  IonSelectOption,
  AlertController,
} from '@ionic/angular';

interface StudentRecord {
  student_no: string;
  full_name: string;
  course: string;
  year_level: number | string;
}

interface StudentProfile extends StudentRecord {
  section: string;
}

interface StudentResponse {
  success: boolean;
  data?: StudentRecord[];
  message?: string;
}

@Component({
  selector: 'app-home',
  templateUrl: 'home.page.html',
  styleUrls: ['home.page.scss'],
imports: [
  IonHeader,
  IonToolbar,
  IonTitle,
  IonContent,
  IonSearchbar,
  IonInput,
  IonSelect,
  IonSelectOption,
  FormsModule,
],
})

export class HomePage implements OnDestroy {
  appName = 'NUNO';
  campus = 'NEUST Sumacab';

private http = inject(HttpClient);
private alertController = inject(AlertController);
private studentRequests = new Subscription();

private continueToLocation = false;
private openingStudentPrompt = false;

studentUrl =
  'https://gelcunanan.link/ionic-php-students-api/api/students.php';

student = signal<StudentProfile | null>(null);
showStudentForm = signal(false);
studentBusy = signal(false);
studentMessage = signal('');
storageMessage = signal('');
canRegister = signal(false);
hapticsEnabled = signal(false);

studentNo = '';
fullName = '';
course = '';
yearLevel = 0;
section = '';

  searchText = signal('');
  selectedPlace = signal<CampusPlace | null>(null);
  mapReady = signal(false);
  mapError = signal(false);

  locationStarting = signal(false);
locationTracking = signal(false);
locationMessage = signal('Location is off.');

private locationWatchId: string | null = null;
private locationSession = 0;
private userMarker?: L.CircleMarker;
private accuracyArea?: L.Polygon;
private centerNextPosition = true;

private onVisibilityChange = () => {
  if (document.hidden) void this.stopLocation();
};

constructor() {
  this.restoreStudent();

  document.addEventListener(
    'visibilitychange',
    this.onVisibilityChange
  );
}

  private campusMap?: L.Map;
  private placeMarker?: L.CircleMarker;

  private mapBounds = L.latLngBounds(
    [0, 0],
    [1360, 1220]
  );

  places: CampusPlace[] = campusPlaces;

  filteredPlaces = computed(() => {
    const search = this.searchText().trim().toLowerCase();

    return this.places.filter((place) => {
const details =
  `${place.mapLabel} ${place.name} ${place.category}`;

      return details.toLowerCase().includes(search);
    });
  });

  searchPlaces(value: string | null | undefined) {
    this.searchText.set(value ?? '');
    this.selectedPlace.set(null);
    this.placeMarker?.remove();
  }

  ionViewDidEnter() {
    if (this.campusMap) {
      this.campusMap.invalidateSize();
      return;
    }

    this.campusMap = L.map('campus-map', {
      crs: L.CRS.Simple,
      minZoom: -3,
      maxZoom: 2,
      zoomSnap: 0.25,
      attributionControl: false,
      scrollWheelZoom: false,
      zoomAnimation: false,
      fadeAnimation: false,
      markerZoomAnimation: false,
    });

    L.imageOverlay(
      'assets/campus-map.png',
      this.mapBounds
    )
      .once('load', () => {
        this.mapReady.set(true);
        this.addMapHotspots();
      })
      .on('error', () => {
        this.mapError.set(true);
      })
      .addTo(this.campusMap);

    this.campusMap.setMaxBounds(
      this.mapBounds.pad(0.15)
    );

    this.resetMap();
  }

  addMapHotspots() {
    const map = this.campusMap;
    if (!map) return;

    for (const place of this.places) {
      const hotspot = L.circle(
        [place.clickY, place.clickX],
        {
          radius: 18,
          stroke: false,
          fillColor: '#fffdf8',
          fillOpacity: 0.01,
          bubblingMouseEvents: false,
          className: 'nuno-map-hotspot',
        }
      ).addTo(map);

      const activate = () => {
        this.searchText.set('');
        this.selectPlace(place);
      };

      hotspot.on('click', activate);

      const element = hotspot.getElement();

      element?.setAttribute('tabindex', '0');
      element?.setAttribute('role', 'button');
      element?.setAttribute(
        'aria-label',
        `Location ${place.mapLabel}: ${place.name}`
      );

      element?.addEventListener('keydown', (event) => {
        if (!(event instanceof KeyboardEvent)) return;

        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          event.stopPropagation();
          activate();
        }
      });
    }
  }

  selectPlace(place: CampusPlace) {
    const isSelected =
      this.selectedPlace()?.id === place.id;

    this.selectedPlace.set(
      isSelected ? null : place
    );

    this.placeMarker?.remove();

    if (isSelected || !this.campusMap) return;

    void this.selectionHaptic();

    const popup = document.createElement('div');

    const title = document.createElement('strong');
    title.textContent = place.name;

    const description = document.createElement('p');
   description.textContent =
  `${place.mapNumber === null ? 'Symbol' : 'Map'} ${place.mapLabel} · ${place.category}. Approximate location.`;

    const detailsButton = document.createElement('button');
    detailsButton.type = 'button';
    detailsButton.className = 'nuno-popup-action';
    detailsButton.textContent = 'View in directory';

    detailsButton.addEventListener('click', () => {
      this.focusPlace(place);
    });

    popup.append(title, description, detailsButton);

    const position = L.latLng(
      place.mapY,
      place.mapX
    );

    this.placeMarker = L.circleMarker(position, {
      radius: 12,
      color: '#fffdf8',
      weight: 3,
      fillColor: '#ad5d25',
      fillOpacity: 1,
      interactive: false,
    })
      .bindPopup(popup)
      .addTo(this.campusMap);

    const zoom = Math.max(
      this.campusMap.getZoom(),
      0
    );

    this.campusMap.setView(position, zoom, {
      animate: false,
    });

    this.placeMarker.openPopup();
  }

  focusPlace(place: CampusPlace) {
    const row = document.getElementById(
      `place-${place.id}`
    );

    row?.scrollIntoView({
      block: 'center',
      behavior: 'instant',
    });

    row?.querySelector('button')?.focus({
      preventScroll: true,
    });
  }

  async startLocation() {
  if (
    !this.mapReady() ||
    this.locationStarting() ||
    this.locationTracking() ||
    this.openingStudentPrompt
  ) return;

  if (this.student()) {
    await this.beginLocation();
    return;
  }

  this.openingStudentPrompt = true;

  try {
    const alert = await this.alertController.create({
      header: 'Set up your student profile',
      message:
        'Add your student details to use My location. You can still explore the map without a profile.',
      cssClass: 'nuno-profile-alert',
      buttons: [
        {
          text: 'Not now',
          role: 'cancel',
        },
        {
          text: 'Set up profile',
          role: 'setup',
        },
      ],
    });

    await alert.present();

    const result = await alert.onDidDismiss();

    if (result.role === 'setup') {
      this.openStudentForm(true);
    }
  } catch {
    this.studentMessage.set(
      'Use the Student profile button to set up your details.'
    );
  } finally {
    this.openingStudentPrompt = false;
  }
}

openStudentForm(forLocation = false) {
  this.continueToLocation = forLocation;
  this.studentMessage.set('');
  this.canRegister.set(false);
  this.showStudentForm.set(true);

  requestAnimationFrame(() => {
    const form = document.getElementById('student-form');

    form?.scrollIntoView({
      block: 'start',
      behavior: 'instant',
    });

    form?.focus({ preventScroll: true });
  });
}

closeStudentForm() {
  this.studentRequests.unsubscribe();
  this.studentRequests = new Subscription();

  this.studentBusy.set(false);
  this.showStudentForm.set(false);
  this.canRegister.set(false);
  this.continueToLocation = false;
}

studentDetailsChanged() {
  this.canRegister.set(false);
  this.studentMessage.set('');
}

validStudentForm() {
  if (
    !this.studentNo.trim() ||
    !this.fullName.trim() ||
    !this.course.trim() ||
    !this.section.trim() ||
    !Number.isInteger(Number(this.yearLevel)) ||
    Number(this.yearLevel) < 1 ||
    Number(this.yearLevel) > 6
  ) {
    this.studentMessage.set(
      'Complete your name, course, year, section and student ID number.'
    );

    return false;
  }

  return true;
}

readStudentRecords(
  response: StudentResponse
): StudentRecord[] | null {
  if (
    response?.success !== true ||
    !Array.isArray(response.data)
  ) return null;

  const valid = response.data.every((record) =>
    record &&
    typeof record.student_no === 'string' &&
    !!record.student_no.trim() &&
    typeof record.full_name === 'string' &&
    !!record.full_name.trim() &&
    typeof record.course === 'string' &&
    !!record.course.trim() &&
    (
      typeof record.year_level === 'number' ||
      typeof record.year_level === 'string'
    ) &&
    Number.isInteger(Number(record.year_level)) &&
    Number(record.year_level) >= 1 &&
    Number(record.year_level) <= 6
  );

  return valid ? response.data : null;
}

checkStudent(verifyCreated = false) {
  if (
    this.studentBusy() ||
    !this.validStudentForm()
  ) return;

  this.studentBusy.set(true);
  this.canRegister.set(false);
  this.studentMessage.set('Checking your student details...');

  this.studentRequests.add(
    this.http
      .get<StudentResponse>(this.studentUrl)
      .pipe(timeout(15000))
      .subscribe({
        next: (res) => {
          this.studentBusy.set(false);

          const records = this.readStudentRecords(res);

          if (!records) {
            this.studentMessage.set(
              'Could not read the student records. Please try again.'
            );
            return;
          }

          const normalize = (value: string) =>
            value.trim().toLowerCase().replace(/\s+/g, ' ');

          const existing = records.find((record) =>
            normalize(record.student_no) ===
            normalize(this.studentNo)
          );

          if (!existing) {
            this.canRegister.set(!verifyCreated);

            this.studentMessage.set(
              verifyCreated
                ? 'Registration was not confirmed. Check your details before retrying.'
                : 'No record found. Choose Create profile to register these details.'
            );
            return;
          }

          if (
            normalize(existing.full_name) !==
              normalize(this.fullName) ||
            normalize(existing.course) !==
              normalize(this.course) ||
            Number(existing.year_level) !==
              Number(this.yearLevel)
          ) {
            this.studentMessage.set(
              'The details do not match this ID number. Check your name, course and year.'
            );
            return;
          }

          this.finishStudentSetup(existing);
        },

        error: () => {
          this.studentBusy.set(false);
          this.studentMessage.set(
            'Could not reach the student API. Your entries are kept. Try again when connected.'
          );
        },
      })
  );
}

postStudent() {
  if (
    this.studentBusy() ||
    !this.canRegister() ||
    !this.validStudentForm()
  ) return;

  const student = {
    student_no: this.studentNo.trim(),
    full_name: this.fullName.trim(),
    course: this.course.trim(),
    year_level: Number(this.yearLevel),
  };

  this.studentBusy.set(true);
  this.canRegister.set(false);
  this.studentMessage.set('Creating your student profile...');

  this.studentRequests.add(
    this.http
      .post<StudentResponse>(this.studentUrl, student)
      .pipe(timeout(15000))
      .subscribe({
        next: () => {
          this.studentBusy.set(false);

          // Read the record back before confirming success.
          this.checkStudent(true);
        },

        error: () => {
          this.studentBusy.set(false);
          this.studentMessage.set(
            'Could not confirm registration. Choose Check details before retrying.'
          );
        },
      })
  );
}

finishStudentSetup(record: StudentRecord) {
  const profile: StudentProfile = {
    ...record,
    year_level: Number(record.year_level),
    section: this.section.trim(),
  };

  this.student.set(profile);
  this.showStudentForm.set(false);
  this.canRegister.set(false);
  this.studentMessage.set('Student profile confirmed.');

  try {
    localStorage.setItem(
      'nuno-student',
      JSON.stringify(profile)
    );

    this.storageMessage.set('');
  } catch {
    this.storageMessage.set(
      'Your profile works for this session, but could not be saved on this device.'
    );
  }

  const startRequested = this.continueToLocation;
  this.continueToLocation = false;

  if (startRequested && !document.hidden) {
    void this.beginLocation();
  }
}

restoreStudent() {
  try {
    this.hapticsEnabled.set(
      localStorage.getItem('nuno-haptics') === 'true'
    );

    const saved: StudentProfile | null = JSON.parse(
      localStorage.getItem('nuno-student') ?? 'null'
    );

    if (
      !saved ||
      typeof saved.section !== 'string' ||
      !saved.section.trim() ||
      !this.readStudentRecords({
        success: true,
        data: [saved],
      })
    ) return;

    this.student.set(saved);
    this.studentNo = saved.student_no;
    this.fullName = saved.full_name;
    this.course = saved.course;
    this.yearLevel = Number(saved.year_level);
    this.section = saved.section;
  } catch {
    // Missing or damaged storage must not stop the map.
  }
}

setHaptics(enabled: boolean) {
  this.hapticsEnabled.set(enabled);

  try {
    localStorage.setItem('nuno-haptics', String(enabled));
  } catch {
    this.storageMessage.set(
      'The vibration setting could not be saved on this device.'
    );
  }

  if (enabled) void this.selectionHaptic();
}

async selectionHaptic() {
  if (
    !this.hapticsEnabled() ||
    !Capacitor.isNativePlatform()
  ) return;

  try {
    await Haptics.impact({
      style: ImpactStyle.Light,
    });
  } catch {
    // Vibration is optional; selection must still work.
  }
}

  async beginLocation() {
  if (
    !this.campusMap ||
    !this.mapReady() ||
    this.locationStarting() ||
    this.locationTracking()
  ) return;

  const session = ++this.locationSession;

  this.locationStarting.set(true);
  this.locationMessage.set('Requesting location...');
  this.centerNextPosition = true;

  try {
    if (Capacitor.isNativePlatform()) {
      const permission = await Geolocation.requestPermissions({
        permissions: ['location'],
      });

      if (session !== this.locationSession) return;

      if (permission.location !== 'granted') {
        this.locationMessage.set(
          'Allow precise location in app settings, then try again.'
        );
        return;
      }
    }

    this.locationTracking.set(true);
    this.locationMessage.set('Finding your location...');

    const id = await Geolocation.watchPosition(
      {
        enableHighAccuracy: true,
        timeout: 20000,
        maximumAge: 0,
        minimumUpdateInterval: 5000,
      },
      (position, error) => {
        if (session !== this.locationSession) return;

        if (error) {
          this.locationMessage.set(
            this.locationErrorMessage(error)
          );
          void this.stopLocation(false);
          return;
        }

        if (position) this.showUserLocation(position);
      }
    );

    if (session !== this.locationSession) {
      await Geolocation.clearWatch({ id });
      return;
    }

    this.locationWatchId = id;
  } catch (error) {
    if (session === this.locationSession) {
      this.locationMessage.set(
        this.locationErrorMessage(error)
      );
      await this.stopLocation(false);
    }
  } finally {
    if (session === this.locationSession) {
      this.locationStarting.set(false);
    }
  }
}

showUserLocation(position: Position) {
  const { latitude, longitude, accuracy } = position.coords;
  const map = this.campusMap;

  if (!map) return;

  this.userMarker?.remove();
  this.accuracyArea?.remove();

  if (
    ![latitude, longitude, accuracy].every(Number.isFinite) ||
    accuracy < 0
  ) {
    this.locationMessage.set(
      'No usable location received. Waiting for GPS...'
    );
    return;
  }

  const point = L.latLng(
    gpsToMap(latitude, longitude)
  );

  const reportedAccuracy = Math.ceil(accuracy);

  if (!this.mapBounds.contains(point)) {
    this.locationMessage.set(
      `GPS position is outside this map. Reported accuracy: ±${reportedAccuracy} m.`
    );
    return;
  }

  this.accuracyArea = L.polygon(
    gpsAccuracyOutline(latitude, longitude, accuracy),
    {
      color: '#2374d5',
      weight: 1,
      fillOpacity: 0.12,
      interactive: false,
    }
  ).addTo(map);

  this.userMarker = L.circleMarker(point, {
    radius: 8,
    color: '#ffffff',
    weight: 3,
    fillColor: '#2374d5',
    fillOpacity: 1,
    interactive: false,
  }).addTo(map);

  this.locationMessage.set(
    `Location updated. GPS accuracy: ±${reportedAccuracy} m.` +
    (
      accuracy > 50
        ? ' Weak accuracy; try an open outdoor area.'
        : ''
    )
  );

  if (this.centerNextPosition) {
    map.setView(
      point,
      Math.max(map.getZoom(), 0),
      { animate: false }
    );

    this.centerNextPosition = false;
  }
}

async stopLocation(showMessage = true) {
  ++this.locationSession;

  this.locationStarting.set(false);
  this.locationTracking.set(false);

  this.userMarker?.remove();
  this.accuracyArea?.remove();

  const id = this.locationWatchId;
  this.locationWatchId = null;

  if (showMessage) {
    this.locationMessage.set('Location is off.');
  }

  if (id !== null) {
    try {
      await Geolocation.clearWatch({ id });
    } catch (error) {
      console.error('Could not clear location watch', error);
    }
  }
}

locationErrorMessage(error: unknown): string {
  const code =
    typeof error === 'object' &&
    error !== null &&
    'code' in error
      ? String(error.code)
      : '';

  if (code === '1' || code === 'OS-PLUG-GLOC-0003') {
    return 'Location permission was denied. Allow it in settings, then try again.';
  }

  if (code === '3' || code === 'OS-PLUG-GLOC-0010') {
    return 'Location timed out. Try again in an open outdoor area.';
  }

  return 'Location is unavailable. Check that device location is on, then try again.';
}

ionViewWillLeave() {
  void this.stopLocation();
}

  resetMap() {
    this.campusMap?.fitBounds(this.mapBounds, {
      padding: [16, 16],
      animate: false,
    });
  }

  focusMap() {
    document.getElementById('map-section')?.scrollIntoView({
      block: 'start',
      behavior: 'instant',
    });

    document.getElementById('campus-map')?.focus({
      preventScroll: true,
    });
  }

ngOnDestroy() {
  this.studentRequests.unsubscribe();

  document.removeEventListener(
    'visibilitychange',
    this.onVisibilityChange
  );

  void this.stopLocation();
  this.campusMap?.remove();
}
}