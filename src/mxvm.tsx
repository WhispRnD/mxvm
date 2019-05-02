import React, {Component, ComponentPropsWithRef, ElementType, PropsWithChildren, RefObject} from "react";
import {observer} from "mobx-react";
import {injectable} from "inversify";
import {action, observable} from "mobx";

/**
 * Marker interface
 */
export interface ViewModel {
}

/**
 * Represents the lifecycle of a ViewModel (similar to a lifecycle of a Component)
 */
export interface BoundViewModelLifecycle {
  onActivate<T>(viewProps: T): void;

  onViewLoaded(viewRef: RefObject<any>): void;

  onDeactivate(): void;
}

export interface BoundViewProps<TViewModel extends ViewModel> {
  model?: TViewModel;
}

@injectable()
export abstract class BoundViewModel implements BoundViewModelLifecycle {
  protected viewRef: React.RefObject<any> | null = null;

  onActivate(props: any) {
  }

  onViewLoaded(viewRef: RefObject<any>) {
    this.viewRef = viewRef;
  }

  onDeactivate() {
  }
}

export type ReactComponent<P = any> =
  | React.FunctionComponent<P>
  | React.ComponentClass<P>
  | React.ClassicComponentClass<P>


interface Newable<T> {
  new(...args: any[]): T;
}

interface Abstract<T> {
  prototype: T;
}

export type ViewModelIdentifier<T> = (string | symbol | Newable<T> | Abstract<T>);


export type ViewModelResolver<TViewModel extends ViewModel> = (vmIdentifier: ViewModelIdentifier<any>, props: any) => TViewModel;

export interface ViewModelRegistry {
  registerInstance(vmIdentifier: ViewModelIdentifier<any>, vm: ViewModel): void;

  unregisterInstance(vmIdentifier: ViewModelIdentifier<any>, vm: ViewModel): void;

  getIdentifiersMap(): Map<ViewModelIdentifier<any>, Set<ViewModel>>;

  buckets: Map<ViewModelIdentifier<any>, Set<ViewModel>>;
}


@injectable()
export class DefaultViewModelRegistry implements ViewModelRegistry {
  @observable buckets = observable.map<ViewModelIdentifier<any>, Set<ViewModel>>();

  @action
  registerInstance(identifier: ViewModelIdentifier<any>, model: ViewModel): void {
    let instances = this.buckets.get(identifier);

    if (!instances) {
      instances = observable.set();
      this.buckets.set(identifier, instances);
    }

    instances.add(model);
  }

  @action
  unregisterInstance(identifier: ViewModelIdentifier<any>, model: ViewModel): void {
    const instances = this.buckets.get(identifier);

    if (instances) {
      instances.delete(model);

      if (!instances.size) {
        this.buckets.delete(identifier);
      }
    }
  }

  getIdentifiersMap(): Map<ViewModelIdentifier<any>, Set<ViewModel>> {
    return this.buckets;
  }
}

@injectable()
export class ViewModelLocator {
  constructor(private viewModelRegistry: ViewModelRegistry) {
  }

  locateMany<T extends ViewModel>(vmIdentifier: ViewModelIdentifier<any>): T[] {
    return Array.from(this.viewModelRegistry.buckets.get(vmIdentifier) as Set<T> || new Set<T>());
  }

  locate<T extends ViewModel>(vmIdentifier: ViewModelIdentifier<any>): T | null {
    return this.locateMany(vmIdentifier)[0] as T || null;
  }
}

export interface BinderProps<TViewModel extends ViewModel> {
  viewModel?: TViewModel;
  viewModelIdentifier: ViewModelIdentifier<any>;
  viewModelResolver: ViewModelResolver<TViewModel>;
  viewComponent: ElementType<ComponentPropsWithRef<any> & Partial<BoundViewProps<TViewModel>>>;
  onUnbind: (vm: ViewModel) => void;
  onBind: (vm: ViewModel) => void;
}

@observer
export class Binder<TViewModel extends ViewModel> extends Component<BinderProps<TViewModel>, { model: TViewModel }> {
  private readonly viewRef: RefObject<any> = React.createRef();

  constructor(props: BinderProps<TViewModel>, context: any) {
    super(props, context);
    const model = this.resolveModel();
    this.state = {model};
    this.props.onBind(model);
  }

  componentWillMount(): void {
    this.notifyOfViewLifecycle(x => x.onActivate, this.props);
  }

  componentDidMount(): void {
    this.notifyOfViewLifecycle(x => x.onViewLoaded, this.viewRef);
  }

  componentDidUpdate(prevProps: Readonly<BinderProps<TViewModel>>, prevState: Readonly<{ model: TViewModel }>, snapshot?: any): void {
    const {viewModel} = this.props;
    if (viewModel != prevProps.viewModel) {
      this.notifyOfViewLifecycle(x => x.onDeactivate);
      this.props.onUnbind(this.state.model);

      const newModel = this.resolveModel();
      this.setState({model: newModel!}, () => this.props.onBind(newModel));
    }
  }

  componentWillUnmount(): void {
    this.notifyOfViewLifecycle(x => x.onDeactivate);
    this.props.onUnbind(this.state.model);
  }

  render() {
    const {viewComponent: ViewComponent, ...props} = this.props;
    return <ViewComponent ref={this.viewRef}
                          model={this.state.model}
                          {...props}/>;
  }

  public get wrappedInstance() {
    return this.viewRef.current;
  }

  private resolveModel() {
    const {viewModel, viewModelResolver, viewModelIdentifier, ...props} = this.props;
    return viewModel || viewModelResolver(viewModelIdentifier, props);
  }

  private notifyOfViewLifecycle(funcResolver: (lifecycle: Partial<BoundViewModelLifecycle>) => Function | undefined, ...args: any[]) {
    const bindingLifecycle = this.state.model as Partial<BoundViewModelLifecycle>;
    const action = funcResolver(bindingLifecycle);
    if (action) {
      action.call(bindingLifecycle, args);
    }
  }
}

export interface MxvmContextProps {
  resolver?: ViewModelResolver<any>;
  registry?: ViewModelRegistry;
}


export interface MxvmProviderProps extends PropsWithChildren<any> {
  resolver: ViewModelResolver<any>;
  registry: ViewModelRegistry;
}

export const MxvmContext = React.createContext<MxvmContextProps>({});

export const MxvmProvider = ({resolver, registry, children}: MxvmProviderProps) =>
  <MxvmContext.Provider value={{resolver, registry}}>
    {children}
  </MxvmContext.Provider>;

// todo: still couldn't find out the right TS signatures, that why there is an 'any' as the return type
export const bindViewModel = <TViewModel extends ViewModel>(vmIdentifier: ViewModelIdentifier<any>):
  <P extends object>(component: ReactComponent<P & BoundViewProps<TViewModel>>) => any =>
  <P extends object>(component: ReactComponent<P & BoundViewProps<TViewModel>>) => {

    const observerComponent = observer(component);

    return ({model, ...props}: { model?: ViewModel } & any) =>
      <MxvmContext.Consumer>
        {({registry, resolver}: MxvmContextProps) => {
          if (!resolver) {
            throw new Error("Resolver has not been provided!");
          }
          if (!registry) {
            throw new Error("Registry has not been provided!");
          }

          return <Binder viewModel={model}
                         viewModelIdentifier={vmIdentifier}
                         viewModelResolver={resolver}
                         viewComponent={observerComponent}
                         onBind={vm => registry.registerInstance(vmIdentifier, vm)}
                         onUnbind={vm => registry.unregisterInstance(vmIdentifier, vm)}
                         {...props}/>
        }}
      </MxvmContext.Consumer>;
  };

